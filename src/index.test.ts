import { ApolloLink, execute, ExecutionResult, Observable } from 'apollo-link'
import gql from 'graphql-tag'
import { Redis } from 'ioredis'
import { when } from 'jest-when'
import { createCacheLink } from '.'

const SAMPLE_QUERY = gql`
  query TranslationsQuery {
    languages(where: { code: "sv_SE" }) {
      translations(where: { project: App }) {
        key {
          value
        }
        text
      }
    }
  }
`
const QUERY_HASH = 'da7ea080280ae735a025b5ec70348829'

const MOCK_ACTUAL_RESULT = { data: {} }

const makeMockDataLink = (spy: jest.Mock): ApolloLink =>
  new ApolloLink(() => {
    return new Observable<ExecutionResult>((observer) => {
      observer.next(MOCK_ACTUAL_RESULT)
      spy()
      observer.complete()
    })
  })

const SAMPLE_VARIABLES = {}
const SAMPLE_EXTENSIONS = {}

type Mockify<T> = { [P in keyof T]: jest.Mock<T[P]> }

const MOCK_CACHED_RESULT = JSON.stringify({})

const makeRedisMock = (): Mockify<Redis> =>
  ({
    get: jest.fn(),
    set: jest.fn(),
  } as any)

it('Should hit the cache when cache value is present', (done) => {
  const redisMock = makeRedisMock()
  redisMock.get.mockReturnValue(Promise.resolve(MOCK_CACHED_RESULT))
  const sut = createCacheLink(redisMock as any)
  execute(sut, {
    query: SAMPLE_QUERY,
    variables: SAMPLE_VARIABLES,
    extensions: SAMPLE_EXTENSIONS,
  }).subscribe({
    next: () => {
      expect(redisMock.get).toHaveBeenCalledTimes(1)
      done()
    },
    complete: () => {
      done()
    },
    error: () => expect(false),
  })
})

it('Should cache the result if no value is present', (done) => {
  const redisMock = makeRedisMock()
  redisMock.get.mockReturnValue(Promise.resolve(undefined))
  const spy = jest.fn()
  const sut = ApolloLink.from([
    createCacheLink(redisMock as any),
    makeMockDataLink(spy),
  ])
  execute(sut, {
    query: SAMPLE_QUERY,
    variables: SAMPLE_VARIABLES,
    extensions: SAMPLE_EXTENSIONS,
  }).subscribe({
    next: (data) => {
      expect(data).toBe(MOCK_ACTUAL_RESULT)
      expect(redisMock.get).toHaveBeenCalledTimes(1)
      expect(redisMock.set).toHaveBeenCalledTimes(2)
    },
    complete: () => {
      expect(spy).toHaveBeenCalledTimes(1)
      done()
    },
    error: () => expect(false),
  })
})

it('Should update the cache when no cache config is present in redis', (done) => {
  const redisMock = makeRedisMock()
  when(redisMock.get)
    .calledWith(QUERY_HASH)
    .mockReturnValue(Promise.resolve(MOCK_CACHED_RESULT))

  when(redisMock.get)
    .calledWith(`${QUERY_HASH}:cache`)
    .mockReturnValue(Promise.resolve(undefined))

  const spy = jest.fn()

  const sut = ApolloLink.from([
    createCacheLink(redisMock as any),
    makeMockDataLink(spy),
  ])
  execute(sut, {
    query: SAMPLE_QUERY,
    variables: SAMPLE_VARIABLES,
    extensions: SAMPLE_EXTENSIONS,
  }).subscribe({
    next: (data) => {
      expect(data).toEqual(JSON.parse(MOCK_CACHED_RESULT))
      expect(redisMock.get).toHaveBeenCalledTimes(1)
      expect(redisMock.set).toHaveBeenCalledTimes(0)
    },
    complete: () => {
      expect(spy).toHaveBeenCalledTimes(0)
      setTimeout(() => {
        expect(spy).toHaveBeenCalledTimes(1)
        expect(redisMock.set).toHaveBeenCalledTimes(2)
        done()
      }, 5)
    },
    error: () => expect(false),
  })
})
