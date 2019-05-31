import { ApolloLink, ExecutionResult, Observable } from 'apollo-link'
import { getMainDefinition } from 'apollo-utilities'
import { createHash } from 'crypto'
import debug from 'debug'
import { print } from 'graphql/language/printer'
import { Redis } from 'ioredis'

const ONE_MINUTE = 60000

const log = debug('apollo-link-redis-cache')

export const createCacheLink = (redis: Redis) =>
  new ApolloLink((operation, forward) => {
    const queryHash = createHash('md5')
      .update(
        JSON.stringify({
          query: print(operation.query),
          variables: operation.variables,
        }),
      )
      .digest('hex')

    log('Handling query with hash: %s', queryHash)

    return new Observable<ExecutionResult>((observer) => {
      if ((getMainDefinition(operation.query) as any).operation !== 'query') {
        log('Call with hash: %s was not of type `Query`, skipping', queryHash)
        if (forward) {
          forward(operation).forEach((linkRes) => {
            observer.next(linkRes)
            observer.complete()
          })
        }
        return
      }

      redis.get(queryHash).then((res) => {
        if (res) {
          log('Cache hit for query with hash: %s', queryHash)
          observer.next(JSON.parse(res) as ExecutionResult)
          observer.complete()
        } else if (forward) {
          log('No cache hit for query with hash: %s', queryHash)
          forward(operation).forEach((linkRes) => {
            updateCacheIfErrorFreeAndOutdated(redis, queryHash, linkRes)
            observer.next(linkRes)
            observer.complete()
          })
          return
        }

        if (forward) {
          log(
            'Queueing up cache refresh check for query with hash: %s',
            queryHash,
          )
          setTimeout(() => {
            log(
              'Checking if cache needs to refresh for query with hash: %s',
              queryHash,
            )
            redis.get(`${queryHash}:cache`).then((cacheRes) => {
              const parsedCacheRes = JSON.parse(cacheRes || '{}')

              if (
                typeof parsedCacheRes.lastSave === 'undefined' ||
                Date.now() > parsedCacheRes.lastSave + ONE_MINUTE
              ) {
                log('Cache considered to be outdated for query: %s', queryHash)
                forward(operation).forEach((linkRes) => {
                  updateCacheIfErrorFreeAndOutdated(redis, queryHash, linkRes)
                })
              }
            })
          }, 0)
        }
      })
    })
  })

const updateCacheIfErrorFreeAndOutdated = (
  redis: Redis,
  queryHash: string,
  linkRes: ExecutionResult,
) => {
  if (linkRes.errors) {
    log(
      'Query with hash: %s contained errors, will not cache result',
      queryHash,
    )
    return
  }

  const timestamp = Date.now()
  log('Caching query with hash: %s at timestamp: %s', queryHash, timestamp)

  redis.set(
    `${queryHash}:cache`,
    JSON.stringify({
      lastSave: Date.now(),
    }),
  )
  redis.set(queryHash, JSON.stringify(linkRes))
}
