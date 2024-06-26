// Copyright (c) Microsoft Corporation and others. Licensed under the MIT license.
// SPDX-License-Identifier: MIT

const tmp = require('tmp')
const semver = require('semver')
const EntitySpec = require('../lib/entitySpec')
const fs = require('fs')
const crypto = require('crypto')
const config = require('painless-config')

tmp.setGracefulCleanup()

class BaseHandler {
  constructor(options) {
    this.options = options
    this.logger = options.logger
  }

  /**
   * Handle the given request in a way appropriate for the given request
   * @param {Request} request
   */
  // eslint-disable-next-line no-unused-vars
  handle(request) {}

  get tmpOptions() {
    const tmpBase = config.get('TEMPDIR') || (process.platform === 'win32' ? 'c:/temp/' : '/tmp/')
    return {
      unsafeCleanup: true,
      template: tmpBase + 'cd-XXXXXX'
    }
  }

  // Compute interesting hashes for the given file
  async computeHashes(file) {
    if (!file) return null
    const sha1 = await this._hashFile(file, 'sha1')
    const sha256 = await this._hashFile(file, 'sha256')
    return { sha1, sha256 }
  }

  _hashFile(path, algorithm) {
    const file = fs.createReadStream(path)
    const hash = crypto.createHash(algorithm)
    hash.setEncoding('hex')
    return new Promise((resolve, reject) => {
      file.on('end', () => {
        hash.end()
        resolve(hash.read())
      })
      file.on('error', error => reject(error))
      file.pipe(hash)
    })
  }

  createTempFile(request) {
    const result = tmp.fileSync(this.tmpOptions)
    request.trackCleanup(result.removeCallback)
    return result
  }

  createTempDir(request) {
    const result = tmp.dirSync(this.tmpOptions)
    request.trackCleanup(result.removeCallback)
    return result
  }

  toSpec(request) {
    return request.casedSpec || EntitySpec.fromUrl(request.url)
  }

  getLatestVersion(versions) {
    if (!Array.isArray(versions)) return versions
    if (versions.length === 0) return null
    if (versions.length === 1) return versions[0]
    return versions
      .filter(v => !this.isPreReleaseVersion(v))
      .reduce((max, current) => (semver.gt(current, max) ? current : max), versions[0])
  }

  isPreReleaseVersion(version) {
    return semver.prerelease(version) !== null
  }

  markSkip(request) {
    return request.markSkip('Missing  ')
  }
}

module.exports = BaseHandler
