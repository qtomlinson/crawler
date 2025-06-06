// Copyright (c) Microsoft Corporation and others. Licensed under the MIT license.
// SPDX-License-Identifier: MIT

const config = require('painless-config')

const cd_azblob = {
  connection: config.get('CRAWLER_AZBLOB_CONNECTION_STRING'),
  container: config.get('CRAWLER_AZBLOB_CONTAINER_NAME'),
  account: config.get('CRAWLER_AZBLOB_ACCOUNT_NAME'),
  spnAuth: config.get('CRAWLER_AZBLOB_SPN_AUTH'),
  isSpnAuth: config.get('CRAWLER_AZBLOB_IS_SPN_AUTH') || false
}

const githubToken = config.get('CRAWLER_GITHUB_TOKEN')

const cd_file = {
  location: config.get('FILE_STORE_LOCATION') || (process.platform === 'win32' ? 'c:/temp/cd' : '/tmp/cd')
}
const crawlerStoreProvider = config.get('CRAWLER_STORE_PROVIDER') || 'cd(file)'
const maxRequeueAttemptCount = config.get('CRAWLER_MAX_REQUEUE_ATTEMPTS') || 5
const fetchedCacheTtlSeconds = config.get('CRAWLER_FETCHED_CACHE_TTL_SECONDS') || 60 * 60 * 8 //8 hours
const azqueueVisibilityTimeoutSeconds = parseInt(config.get('CRAWLER_HARVESTS_QUEUE_VISIBILITY_TIMEOUT_SECONDS'))

function getPositiveNum(configName, defaultValue) {
  const num = Number(config.get(configName))
  return num > 0 ? num : defaultValue
}

module.exports = {
  provider: 'memory', // change this to redis if/when we want distributed config
  searchPath: [module],
  crawler: {
    count: 2,
    maxRequeueAttemptCount
  },
  filter: {
    provider: 'filter',
    filter: {}
  },
  fetch: {
    dispatcher: 'cdDispatch',
    cdDispatch: {
      fetched: { defaultTtlSeconds: fetchedCacheTtlSeconds }
    },
    cocoapods: { githubToken },
    conda: {
      cdFileLocation: cd_file.location
    },
    cratesio: {},
    debian: { cdFileLocation: cd_file.location },
    git: {},
    go: { maxRequeueAttemptCount },
    mavenCentral: {},
    mavenGoogle: {},
    gradlePlugin: {},
    npmjs: {},
    nuget: {},
    packagist: {},
    pypi: {},
    rubygems: {}
  },
  process: {
    cdsource: {},
    component: {},
    conda: { githubToken },
    condasrc: {},
    crate: { githubToken },
    deb: {},
    debsrc: {},
    fossology: {
      disabled: true,
      installDir: config.get('FOSSOLOGY_HOME') || '/mnt/c/git/fo/fossology/src/'
    },
    gem: { githubToken },
    go: { githubToken },
    licensee: {
      processes: getPositiveNum('CRAWLER_LICENSEE_PARALLELISM', 10)
    },
    maven: { githubToken },
    npm: { githubToken },
    nuget: { githubToken },
    package: {},
    composer: { githubToken },
    pod: { githubToken },
    pypi: { githubToken },
    reuse: {},
    scancode: {
      installDir: config.get('SCANCODE_HOME'),
      options: [
        '--copyright',
        '--info',
        '--package',
        '--strip-root',
        '--email',
        '--url',
        '--classify',
        '--generated',
        '--license',
        '--license-clarity-score',
        '--license-references',
        '--license-text',
        '--license-text-diagnostics',
        '--summary',
        '--tallies',
        '--tallies-key-files'
        // '--quiet'
      ],
      timeout: 1000,
      processes: Number(config.get('CRAWLER_SCANCODE_PARALLELISM') || process.env.CRAWLER_SCANCODE_PARALLELISM) || 2,
      format: '--json-pp'
    },
    source: {},
    sourcearchive: {},
    top: { githubToken }
  },
  store: {
    dispatcher: crawlerStoreProvider,
    cdDispatch: {},
    webhook: {
      url: config.get('CRAWLER_WEBHOOK_URL') || 'http://localhost:4000/webhook',
      token: config.get('CRAWLER_WEBHOOK_TOKEN')
    },
    azqueue: {
      connectionString: cd_azblob.connection,
      account: cd_azblob.account,
      queueName: config.get('CRAWLER_HARVESTS_QUEUE_NAME') || 'harvests',
      spnAuth: config.get('CRAWLER_HARVESTS_QUEUE_SPN_AUTH'),
      isSpnAuth: config.get('CRAWLER_HARVESTS_QUEUE_IS_SPN_AUTH') || false,
      visibilityTimeout: isNaN(azqueueVisibilityTimeoutSeconds) ? 0 : azqueueVisibilityTimeoutSeconds
    },
    'cd(azblob)': cd_azblob,
    'cd(file)': cd_file
  },
  deadletter: {
    provider: config.get('CRAWLER_DEADLETTER_PROVIDER') || crawlerStoreProvider,
    'cd(azblob)': cd_azblob,
    'cd(file)': cd_file
  },
  queue: {
    provider: config.get('CRAWLER_QUEUE_PROVIDER') || 'memory',
    memory: {
      weights: { immediate: 3, soon: 2, normal: 3, later: 2 }
    },
    storageQueue: {
      weights: { immediate: 3, soon: 2, normal: 3, later: 2 },
      connectionString: config.get('CRAWLER_QUEUE_AZURE_CONNECTION_STRING') || cd_azblob.connection,
      queueName: config.get('CRAWLER_QUEUE_PREFIX') || 'cdcrawlerdev',
      visibilityTimeout: 8 * 60 * 60, // 8 hours
      visibilityTimeout_remainLocal: fetchedCacheTtlSeconds,
      maxDequeueCount: 5,
      attenuation: {
        ttl: 3000
      },
      spnAuth: config.get('CRAWLER_QUEUE_AZURE_SPN_AUTH') || cd_azblob.spnAuth,
      account: config.get('CRAWLER_QUEUE_AZURE_ACCOUNT_NAME') || cd_azblob.account,
      isSpnAuth: config.get('CRAWLER_QUEUE_AZURE_IS_SPN_AUTH') || false
    },
    appVersion: config.get('APP_VERSION'),
    buildsha: config.get('BUILD_SHA')
  }
}
