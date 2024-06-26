// Copyright (c) Microsoft Corporation and others. Licensed under the MIT license.
// SPDX-License-Identifier: MIT

const AbstractFetch = require('./abstractFetch')
const { exec } = require('child_process')
const { clone } = require('lodash')
const { rm } = require('fs').promises
const FetchResult = require('../../lib/fetchResult')

const providerMap = {
  gitlab: 'https://gitlab.com',
  github: 'https://github.com'
}

class GitCloner extends AbstractFetch {
  canHandle(request) {
    const spec = this.toSpec(request)
    return request.type !== 'source' && spec && spec.type === 'git'
  }

  async handle(request) {
    const SourceSpec = require('../../lib/sourceSpec')

    super.handle(request)
    const spec = this.toSpec(request)
    const sourceSpec = SourceSpec.fromObject(spec)
    const options = { version: sourceSpec.revision }
    const dir = this.createTempDir(request)
    const repoSize = await this._cloneRepo(sourceSpec.toUrl(), dir.name, spec.name, options.version)
    request.addMeta({ gitSize: repoSize })
    spec.revision = await this._getRevision(dir.name, spec.name)
    request.url = spec.toUrl()
    const releaseDate = await this._getDate(dir.name, spec.name)
    await this._deleteGitDatabase(dir.name, spec.name)

    const fetchResult = new FetchResult(request.url).addMeta({ gitSize: repoSize })
    fetchResult.document = this._createDocument(dir.name + '/' + spec.name, repoSize, releaseDate, options.version)
    if (spec.provider === 'github') {
      fetchResult.casedSpec = clone(spec)
      fetchResult.casedSpec.namespace = spec.namespace.toLowerCase()
      fetchResult.casedSpec.name = spec.name.toLowerCase()
    }
    request.fetchResult = fetchResult.adoptCleanup(dir, request)
    return request
  }

  _createDocument(location, size, releaseDate, commit) {
    // Create a simple document that records the location and the size of the repo that was fetched
    return { location, size, releaseDate, hashes: { gitSha: commit } }
  }

  _cloneRepo(sourceUrl, dirName, specName, commit) {
    const reset = commit ? `&& git reset --hard ${commit} --quiet` : ''
    return new Promise((resolve, reject) => {
      exec(
        `cd ${dirName} && git clone ${sourceUrl} --quiet && cd ${specName} ${reset} && git count-objects -v`,
        (error, stdout) => (error ? reject(error) : resolve(this._getRepoSize(stdout)))
      )
    })
  }

  _getDate(dirName, specName) {
    return new Promise((resolve, reject) => {
      exec(`cd ${dirName}/${specName} && git show -s --format=%ci`, (error, stdout) =>
        error ? reject(error) : resolve(new Date(stdout.trim()))
      )
    })
  }

  /**
   * We normalize the revision so that they are consistent in the harvested output
   * this allows a shortened commit hash as input to be saved as a full commit hash
   * this also allows git-like words like 'HEAD' and also tag names to be normalized
   */
  _getRevision(dirName, specName) {
    return new Promise((resolve, reject) => {
      exec(`cd ${dirName}/${specName} && git rev-parse HEAD`, (error, stdout) =>
        error ? reject(error) : resolve(stdout.trim())
      )
    })
  }

  _getRepoSize(gitCountObjectsResult = '') {
    // ...\nsize-pack: 3\n... (in KB)
    return Number(gitCountObjectsResult.match('size-pack: (.*)\n')[1])
  }

  _deleteGitDatabase(dirName, specName) {
    return rm(`${dirName}/${specName}/.git`, { recursive: true, force: true })
  }

  _buildUrl(spec) {
    const fullName = `${spec.namespace.replace(/\./g, '/')}/${spec.name}`
    return `${providerMap[spec.provider]}/${fullName}.git`
  }
}

module.exports = options => new GitCloner(options)
