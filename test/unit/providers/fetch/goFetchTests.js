// Copyright (c) Microsoft Corporation and others. Licensed under the MIT license.
// SPDX-License-Identifier: MIT
const expect = require('chai').expect
const sinon = require('sinon')
const GoFetch = require('../../../../providers/fetch/goFetch')
const PassThrough = require('stream').PassThrough
const proxyquire = require('proxyquire')
const Request = require('../../../../ghcrawler').request
const fs = require('fs')

const stub = 'https://proxy.golang.org/'

describe('Go utility functions', () => {
  it('builds URLs', () => {
    const fetch = GoFetch({})
    expect(fetch._buildUrl(spec('go', 'golang.org', 'x', 'net', 'v0.0.0-20210226172049-e18ecbb05110'))).to.equal(stub + 'golang.org/x/net/@v/v0.0.0-20210226172049-e18ecbb05110.zip')
    expect(fetch._buildUrl(spec('go', 'golang.org', 'x', 'net', 'v0.0.0-20210226172049-e18ecbb05110'), '.mod')).to.equal(stub + 'golang.org/x/net/@v/v0.0.0-20210226172049-e18ecbb05110.mod')
    expect(fetch._buildUrl(spec('go', '-', '-', 'collectd.org', 'v0.5.0'))).to.equal(stub + 'collectd.org/@v/v0.5.0.zip')
    expect(fetch._buildUrl(spec('go', 'cloud.google.com', '-', 'go', 'v0.56.0'))).to.equal(stub + 'cloud.google.com/go/@v/v0.56.0.zip')
    expect(fetch._buildUrl(spec('go', 'github.com', 'Azure%2fazure-event-hubs-go', 'v3', 'v3.2.0'))).to.equal(stub + 'github.com/Azure/azure-event-hubs-go/v3/@v/v3.2.0.zip')
  })
})


const hashes = {
  'v1.3.0.zip': {
    sha1: 'da39a3ee5e6b4b0d3255bfef95601890afd80709',
    sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
  }
}

let Fetch

function pickArtifact(url) {
  if (url.endsWith('.mod')) return 'v1.3.0.mod'
  if (url.endsWith('.info')) return 'v1.3.0.info'
  if (url.endsWith('.zip')) return 'v1.3.0.zip'
  return null
}

describe('Go Proxy fetching', () => {
  beforeEach(() => {
    const requestPromiseStub = options => {
      if (options.url) {
        if (options.url.includes('error')) throw new Error('yikes')
        if (options.url.includes('code')) throw { statusCode: 500, message: 'Code' }
        if (options.url.includes('missing')) throw { statusCode: 404 }
      }
      const file = pickArtifact(options.url)
      const content = fs.readFileSync(`test/fixtures/go/${file}`)
      return options.json ? JSON.parse(content) : content
    }

    const getStub = (url, callback) => {
      const response = new PassThrough()
      const file = `test/fixtures/go/${pickArtifact(url)}`
      if (file) {
        response.write(fs.readFileSync(file))
        callback(null, { statusCode: 200 })
      } else {
        callback(new Error(url.includes('error') ? 'Error' : 'Code'))
      }
      response.end()
      return response
    }
    Fetch = proxyquire('../../../../providers/fetch/goFetch', {
      request: { get: getStub },
      'request-promise-native': requestPromiseStub
    })
  })

  afterEach(function () {
    sinon.sandbox.restore()
  })

  it('succeeds in download, decompress, and hash', async () => {
    const handler = Fetch({ logger: { log: sinon.stub() } })
    const request = await handler.handle(new Request('test', 'cd:/go/golang.org/x/net/v0.0.0-20210226172049-e18ecbb05110'))
    expect(request.document.hashes.sha1).to.be.equal(hashes['v1.3.0.zip']['sha1'])
    expect(request.document.hashes.sha256).to.be.equal(hashes['v1.3.0.zip']['sha256'])
    expect(request.document.releaseDate).to.equal('2018-02-14T00:54:53Z')
  })
})

function spec(type, provider, namespace, name, revision) {
  return { type, provider, namespace, name, revision }
}