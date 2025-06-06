// (c) Copyright 2021, SAP SE and ClearlyDefined contributors. Licensed under the MIT license.
// SPDX-License-Identifier: MIT

const AbstractFetch = require('./abstractFetch')
const { callFetch, defaultHeaders } = require('../../lib/fetch')
const nodeRequest = require('request')
const { clone, get } = require('lodash')
const { promisify } = require('util')
const fs = require('fs')
const exists = promisify(fs.exists)
const readdir = promisify(fs.readdir)
const lstat = promisify(fs.lstat)
const path = require('path')
const parseString = promisify(require('xml2js').parseString)
const EntitySpec = require('../../lib/entitySpec')
const { extractDate } = require('../../lib/utils')
const FetchResult = require('../../lib/fetchResult')

const extensionMap = {
  sourcesJar: '-sources.jar',
  pom: '.pom',
  aar: '.aar',
  jar: '.jar'
}

class MavenBasedFetch extends AbstractFetch {
  constructor(providerMap, options) {
    super(options)
    this._providerMap = { ...providerMap }
    this._handleRequestPromise = options.requestPromise || callFetch
    this._handleRequestStream = options.requestStream || nodeRequest.defaults({ headers: defaultHeaders }).get
  }

  canHandle(request) {
    const spec = this.toSpec(request)
    return !!this._providerMap[spec?.provider]
  }

  async handle(request) {
    const spec = this.toSpec(request)
    if (!spec.revision) spec.revision = await this._getLatestVersion(spec)
    if (!spec.namespace || !spec.revision) return this.markSkip(request)
    // rewrite the request URL as it is used throughout the system to derive locations and urns etc.
    request.url = spec.toUrl()
    super.handle(request)
    const poms = await this._getPoms(spec)
    if (!poms.length) return this.markSkip(request)
    const summary = this._mergePoms(poms)
    const artifact = this.createTempFile(request)
    const artifactResult = await this._getArtifact(spec, artifact.name)
    if (!artifactResult) return this.markSkip(request)
    const dir = this.createTempDir(request)
    await this.decompress(artifact.name, dir.name)
    const hashes = await this.computeHashes(artifact.name)
    const releaseDate = await this._getReleaseDate(dir.name, spec)

    const fetchResult = new FetchResult(request.url)
    fetchResult.document = this._createDocument(dir, releaseDate, hashes, poms, summary)
    if (get(summary, 'groupId[0]') || get(summary, 'artifactId[0]')) {
      fetchResult.casedSpec = clone(spec)
      fetchResult.casedSpec.namespace = get(summary, 'groupId[0]') || spec.namespace
      fetchResult.casedSpec.name = get(summary, 'artifactId[0]') || spec.name
    }
    request.fetchResult = fetchResult.adoptCleanup(dir, request)
    return request
  }

  async _getLatestVersion(spec) {
    //Use Maven repository meta data model to get the latest version
    //https://maven.apache.org/ref/3.2.5/maven-repository-metadata/repository-metadata.html#class_versioning
    const url = `${this._buildBaseUrl(spec)}/maven-metadata.xml`
    const response = await this._requestPromise({ url, json: false })
    if (!response) return null
    const meta = await parseString(response)
    return get(meta, 'metadata.versioning[0].release[0]')
  }

  _createDocument(dir, releaseDate, hashes, poms, summary) {
    return { location: dir.name, releaseDate, hashes, poms, summary }
  }

  _buildBaseUrl(spec) {
    const fullName = `${spec.namespace?.replace(/\./g, '/')}/${spec.name}`
    return `${this._providerMap[spec.provider]}${fullName}`
  }

  _buildUrl(spec, extension = extensionMap.jar) {
    return `${this._buildBaseUrl(spec)}/${spec.revision}/${spec.name}-${spec.revision}${extension}`
  }

  async _getArtifact(spec, destination) {
    const extensions = spec.type === 'sourcearchive' ? [extensionMap.sourcesJar] : [extensionMap.jar, extensionMap.aar]
    for (let extension of extensions) {
      const url = this._buildUrl(spec, extension)
      const status = await new Promise(resolve => {
        this._handleRequestStream(url, (error, response) => {
          if (error) this.logger.error(error)
          if (response.statusCode !== 200) return resolve(false)
        }).pipe(fs.createWriteStream(destination).on('finish', () => resolve(true)))
      })
      if (status) return true
    }
    return false
  }

  async _getPoms(spec, result = []) {
    const pom = await this._getPom(spec)
    const parentSpec = this._buildParentSpec(pom, spec)
    if (parentSpec) await this._getPoms(parentSpec, result)
    if (pom) result.push(pom)
    return result
  }

  async _getPom(spec) {
    const url = this._buildUrl(spec, extensionMap.pom)
    const content = await this._requestPromise({ url, json: false })
    if (!content) return null
    const pom = await parseString(content)
    // clean up some stuff we don't actually look at.
    delete pom.project.build
    delete pom.project.dependencies
    delete pom.project.dependencyManagement
    delete pom.project.modules
    delete pom.project.profiles
    return pom
  }

  _buildParentSpec(pom, spec) {
    if (!pom || !pom.project || !pom.project.parent) return null
    const parent = pom.project.parent[0]
    return new EntitySpec(
      spec.type,
      spec.provider,
      parent.groupId[0].trim(),
      parent.artifactId[0].trim(),
      parent.version[0].trim()
    )
  }

  _mergePoms(poms) {
    if (!poms) return null
    return [...poms].reduce((result, pom) => {
      return { ...result, ...pom.project }
    }, {})
  }

  async _getReleaseDate(dirName, spec) {
    const location = path.join(dirName, `META-INF/${spec.type}/${spec.namespace}/${spec.name}/pom.properties`)
    if (await exists(location)) {
      const pomProperties = (await promisify(fs.readFile)(location)).toString().split('\n')
      for (const line of pomProperties) {
        const releaseDate = extractDate(line.slice(1))
        if (releaseDate) return releaseDate.toJSDate().toISOString()
      }
    }
    //Get "File Data Last Modified" from the MANIFEST.MF file, and infer release date.
    const manifest = path.join(dirName, 'META-INF/MANIFEST.MF')
    if (await exists(manifest)) {
      const stats = await fs.promises.stat(manifest)
      return stats.mtime.toISOString()
    }

    //For archives which do not contain the META-INF/MANIFEST.MF file, use mtime from any file
    //in the decompressed directory to infer release date
    const fileStat = await MavenBasedFetch._findAnyFileStat(dirName)
    return fileStat?.mtime.toISOString()
  }

  static async _findAnyFileStat(location) {
    const locationStat = await lstat(location)
    if (locationStat.isSymbolicLink()) return
    if (locationStat.isFile()) return locationStat

    const subdirs = await readdir(location)
    return subdirs.reduce((prev, subdir) => {
      const entry = path.resolve(location, subdir)
      return prev.then(result => result || MavenBasedFetch._findAnyFileStat(entry))
    }, Promise.resolve())
  }

  async _requestPromise(options) {
    try {
      return await this._handleRequestPromise(options)
    } catch (error) {
      if (error.statusCode === 404) return null
      else throw error
    }
  }
}

module.exports = MavenBasedFetch
