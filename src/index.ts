import { ApolloLink, ExecutionResult, Observable } from 'apollo-link'
import { getMainDefinition } from 'apollo-utilities'
import { createHash } from 'crypto'
import { print } from 'graphql/language/printer'
import { Redis } from 'ioredis'

const ONE_MINUTE = 60000

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

    return new Observable<ExecutionResult>((observer) => {
      if ((getMainDefinition(operation.query) as any).operation !== 'query') {
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
          observer.next(JSON.parse(res) as ExecutionResult)
          observer.complete()
        } else if (forward) {
          forward(operation).forEach((linkRes) => {
            updateCacheIfErrorFreeAndOutdated(redis, queryHash, linkRes)
            observer.next(linkRes)
            observer.complete()
          })
          return
        }

        if (forward) {
          setTimeout(() => {
            redis.get(`${queryHash}:cache`).then((cacheRes) => {
              const parsedCacheRes = JSON.parse(cacheRes || '{}')

              if (new Date().getTime() > parsedCacheRes.lastSave + ONE_MINUTE) {
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
    return
  }

  redis.set(
    `${queryHash}:cache`,
    JSON.stringify({
      lastSave: new Date().getTime(),
    }),
  )
  redis.set(queryHash, JSON.stringify(linkRes))
}
