import { ApolloLink, ExecutionResult, Observable } from 'apollo-link'
import { Redis } from 'ioredis'

export const createCacheLink = (redis: Redis) =>
  new ApolloLink((operation, forward) => {
    const query = JSON.stringify(operation.query)
    return new Observable<ExecutionResult>((observer) => {
      redis.get(query).then((res) => {
        if (res) {
          observer.next(JSON.parse(res) as ExecutionResult)
          observer.complete()
        } else if (forward) {
          forward(operation).forEach((linkRes) => {
            updateCacheIfErrorFreeAndOutdated(redis, query, linkRes, res)
            observer.next(linkRes)
            observer.complete()
          })
          return
        }
        if (forward) {
          setTimeout(() => {
            forward(operation).forEach((linkRes) => {
              updateCacheIfErrorFreeAndOutdated(redis, query, linkRes, res)
            })
          }, 0)
        }
      })
    })
  })

const updateCacheIfErrorFreeAndOutdated = (
  redis: Redis,
  query: string,
  linkRes: ExecutionResult,
  cachedRes: string | null,
) => {
  if (linkRes.errors) {
    return
  }

  const linkResAsString = JSON.stringify(linkRes)
  if (linkResAsString === cachedRes) {
    return
  }
  redis.set(query, linkResAsString)
}
