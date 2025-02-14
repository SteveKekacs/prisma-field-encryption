import { cloakedStringRegex } from '@47ng/cloak'
import fs from 'node:fs/promises'
import path from 'node:path'
import { errors } from '../errors'
import { makeExtensionClient, makeMiddlewareClient } from './prismaClient'
import * as sqlite from './sqlite'

const clients = [
  { type: 'middleware', client: makeMiddlewareClient() },
  { type: 'extension', client: makeExtensionClient() }
]

describe.each(clients)('integration ($type)', ({ client }) => {
  beforeAll(() => {
    // Reset database
    const src = path.resolve(process.cwd(), 'prisma', 'db.test.sqlite')
    const dst = path.resolve(process.cwd(), 'prisma', 'db.integration.sqlite')
    return fs.copyFile(src, dst)
  })

  const email = '007@hmss.gov.uk'

  test('create user', async () => {
    const received = await client.user.create({
      data: {
        email,
        name: 'James Bond'
      }
    })
    const dbValue = await sqlite.get({ table: 'User', where: { email } })
    expect(received.name).toEqual('James Bond') // clear text in returned value
    expect(dbValue.name).toMatch(cloakedStringRegex) // encrypted in database
  })

  test('query user by encrypted field', async () => {
    let received = await client.user.findFirst({
      where: {
        name: 'James Bond'
      }
    })
    expect(received!.name).toEqual('James Bond')
    // Should also work with long form:
    received = await client.user.findFirst({
      where: {
        name: {
          equals: 'James Bond'
        }
      }
    })
    expect(received!.name).toEqual('James Bond')
    // Should also work with boolean logic:
    received = await client.user.findFirst({
      where: {
        OR: [
          {
            name: 'James Bond'
          },
          {
            name: 'Bond, James Bond.'
          }
        ]
      }
    })
    expect(received!.name).toEqual('James Bond')
  })

  test('query user by encrypted field (with equals)', async () => {
    const received = await client.user.findFirst({
      where: {
        name: {
          equals: 'James Bond'
        }
      }
    })
    expect(received!.name).toEqual('James Bond')
  })

  test('query user by encrypted field with complex query', async () => {
    const received = await client.user.findFirst({
      where: {
        OR: [
          {
            name: {
              equals: 'James Bond'
            }
          },
          {
            AND: [
              {
                NOT: {
                  name: 'Dr. No'
                }
              }
            ]
          }
        ]
      }
    })
    expect(received!.name).toEqual('James Bond')
  })

  test('delete user', async () => {
    const received = await client.user.delete({ where: { email } })
    expect(received.name).toEqual('James Bond')
  })

  test('create post & associated user', async () => {
    const received = await client.post.create({
      data: {
        title: "I'm back",
        content: 'You only live twice.',
        author: {
          create: {
            email,
            name: 'James Bond'
          }
        }
      },
      select: {
        id: true,
        author: true,
        content: true
      }
    })
    const user = await sqlite.get({ table: 'User', where: { email } })
    const post = await sqlite.get({
      table: 'Post',
      where: { id: received.id.toString() }
    })
    expect(received.author?.name).toEqual('James Bond')
    expect(received.content).toEqual('You only live twice.')
    expect(user.name).toMatch(cloakedStringRegex)
    expect(post.content).toMatch(cloakedStringRegex)
    expect(post.title).toEqual("I'm back") // clear text in the database
  })

  test('update user', async () => {
    const received = await client.user.update({
      data: {
        name: 'The name is Bond...'
      },
      where: {
        email
      }
    })
    const user = await sqlite.get({ table: 'User', where: { email } })
    expect(received.name).toEqual('The name is Bond...')
    expect(user.name).toMatch(cloakedStringRegex)
  })

  test('update user (with set)', async () => {
    const received = await client.user.update({
      data: {
        name: {
          set: '...James Bond.'
        }
      },
      where: {
        email
      }
    })
    const user = await sqlite.get({ table: 'User', where: { email } })
    expect(received.name).toEqual('...James Bond.')
    expect(user.name).toMatch(cloakedStringRegex)
    await client.user.delete({
      where: {
        email
      }
    })
  })

  test('complex query nesting', async () => {
    const received = await client.user.create({
      data: {
        email: '006@hmss.gov.uk',
        name: 'Alec Trevelyan',
        posts: {
          create: [
            {
              title: '006 - First report',
              content: 'For England, James?'
            },
            {
              title: 'Janus Quotes',
              content: "I've set the timers for six minutes",
              categories: {
                create: {
                  name: 'Quotes'
                }
              }
            }
          ]
        }
      },
      include: {
        posts: {
          include: {
            categories: true
          }
        }
      }
    })
    expect(received.name).toEqual('Alec Trevelyan')
    expect(received.posts[0].content).toEqual('For England, James?')
    expect(received.posts[1].content).toEqual(
      "I've set the timers for six minutes"
    )
    const user = await sqlite.get({
      table: 'User',
      where: { email: '006@hmss.gov.uk' }
    })
    const post1 = await sqlite.get({
      table: 'Post',
      where: { id: received.posts[0].id.toString() }
    })
    const post2 = await sqlite.get({
      table: 'Post',
      where: { id: received.posts[1].id.toString() }
    })
    const category = await sqlite.get({
      table: 'Category',
      where: { name: 'Quotes' }
    })
    expect(user.name).toMatch(cloakedStringRegex)
    expect(post1.content).toMatch(cloakedStringRegex)
    expect(post2.content).toMatch(cloakedStringRegex)
    expect(category.name).toEqual('Quotes')
  })

  test('top level with no encrypted field, nested with encrypted field - using select', async () => {
    const created = await client.post.create({
      data: {
        title: "I'm back",
        content: 'You only live twice.',
        categories: {
          create: {
            name: 'Secret agents'
          }
        },
        author: {
          create: {
            email,
            name: 'James Bond'
          }
        }
      },
      select: {
        id: true,
        author: true,
        content: true,
        categories: true
      }
    })

    const category = await client.category.findFirst({
      select: {
        name: true,
        posts: {
          select: {
            content: true
          }
        }
      },
      where: {
        id: { equals: created.categories![0].id }
      }
    })

    expect(category?.name).toEqual('Secret agents')
    expect(category?.posts[0].content).toEqual('You only live twice.')
  })

  test('immutable params', async () => {
    const email = 'xenia@cccp.ru'
    const params = {
      data: {
        name: 'Xenia Onatop',
        email
      }
    }
    const received = await client.user.create(params)
    const user = await sqlite.get({ table: 'User', where: { email } })
    expect(params.data.name).toEqual('Xenia Onatop')
    expect(received.name).toEqual('Xenia Onatop')
    expect(user.name).toMatch(cloakedStringRegex)
  })

  test('orderBy is not supported', async () => {
    const cer = console.error
    console.error = jest.fn()
    let received = await client.user.findMany({
      orderBy: {
        name: 'desc'
      }
    })
    expect(received.length).toEqual(3)
    // If 'desc' order was respected, those should be the other way around.
    // This test verifies that the directive is dropped and natural order
    // is preserved.
    expect(received[0].name).toEqual('Alec Trevelyan')
    expect(received[1].name).toEqual('James Bond')
    expect(received[2].name).toEqual('Xenia Onatop')
    expect(console.error).toHaveBeenLastCalledWith(
      errors.orderByUnsupported('User', 'name')
    )
    // @ts-ignore
    console.error.mockClear()
    // Test array syntax
    received = await client.user.findMany({
      orderBy: [{ name: 'asc' }]
    })
    expect(received[0].name).toEqual('Alec Trevelyan')
    expect(received[1].name).toEqual('James Bond')
    expect(received[2].name).toEqual('Xenia Onatop')
    expect(console.error).toHaveBeenLastCalledWith(
      errors.orderByUnsupported('User', 'name')
    )
    console.error = cer
  })

  test('connect on hashed field', async () => {
    const content = 'You can connect to a hashed encrypted field.'
    const received = await client.post.create({
      data: {
        title: 'Connected',
        content,
        author: {
          connect: {
            name: 'James Bond'
          }
        }
      },
      include: {
        author: true
      }
    })
    expect(received.author?.name).toEqual('James Bond')
    expect(received.content).toEqual(content)
  })

  test('cursor on hashed field', async () => {
    const received = await client.user.findMany({
      take: 1,
      cursor: {
        name: 'James Bond'
      }
    })
    expect(received[0].name).toEqual('James Bond')
  })

  test('transactions', async () => {
    const id = await client.$transaction(async tx => {
      const post = await tx.post.create({
        data: {
          title: 'Mission orders',
          author: {
            connect: {
              name: 'James Bond'
            }
          },
          content: `This message will self-destruct in 5 seconds
              (oops, wrong spy show)`
        }
      })
      await tx.post.delete({ where: { id: post.id } })
      return post.id
    })
    const post = await client.post.findUnique({ where: { id } })
    expect(post).toBeNull()
  })

  test('transactions with rollback', async () => {
    try {
      await client.$transaction(async tx => {
        const post = await tx.post.create({
          data: {
            title: 'Mission orders',
            author: {
              connect: {
                name: 'James Bond'
              }
            },
            content: `This message will self-destruct in 5 seconds
              (oops, wrong spy show)`
          }
        })
        // Simulate a transaction failure to test rollback
        throw post.id
      })
    } catch (id) {
      const post = await client.post.findUnique({ where: { id: id as number } })
      expect(post).toBeNull()
      return
    }
    // Should be unreachable
    const reached = true
    expect(reached).toBe(false)
  })

  test("Doesn't work with the Fluent API", async () => {
    const posts = await client.user.findUnique({ where: { email } }).posts()
    for (const post of posts!) {
      expect(post.content).toMatch(cloakedStringRegex)
    }
  })

  test('query entries with non-empty name', async () => {
    const fakeName = 'f@keU$er'
    await client.user.create({
      data: {
        name: '',
        email: 'test_mail@example.com'
      }
    })
    const users = await client.user.findMany()
    // assume active user with nonempty name
    const activeUserCount = await client.user.count({
      where: { name: { not: '' } }
    })
    // use fakeName to pretend unique name
    const existingUsers = await client.user.findMany({
      where: { name: { not: fakeName } }
    })
    expect(activeUserCount).toBe(users.length - 1)
    expect(existingUsers).toEqual(users)
  })

  const normalizeTestEmail = 'normalize@example.com'

  test('create user with normalizeable name', async () => {
    const received = await client.user.create({
      data: {
        email: normalizeTestEmail,
        name: ' François'
      }
    })
    const dbValue = await sqlite.get({
      table: 'User',
      where: { email: normalizeTestEmail }
    })
    expect(received.name).toEqual(' François') // clear text in returned value
    expect(dbValue.name).toMatch(cloakedStringRegex) // encrypted in database
  })

  test('query user by encrypted and hashed name field with a normalized input (with equals)', async () => {
    const received = await client.user.findFirst({
      where: {
        name: {
          equals: 'Francois' //check for lowercase, trim and diacritics
        }
      }
    })
    expect(received!.name).toEqual(' François') // clear text in returned value
    expect(received!.email).toEqual(normalizeTestEmail)
  })
})
