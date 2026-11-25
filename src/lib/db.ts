import { openDB, type IDBPDatabase } from 'idb'
import type { StoredItem } from './types'

export interface FontRecord {
  name: string
  data: ArrayBuffer
  added: number
}

let dbp: Promise<IDBPDatabase> | null = null

function db() {
  if (!dbp) {
    dbp = openDB('petkol', 1, {
      upgrade(d) {
        d.createObjectStore('items', { keyPath: 'id' })
        d.createObjectStore('meta')
        d.createObjectStore('fonts', { keyPath: 'name' })
      },
    })
  }
  return dbp
}

export async function allItems(): Promise<StoredItem[]> {
  return (await db()).getAll('items')
}

export async function putItem(item: StoredItem) {
  await (await db()).put('items', item)
}

export async function putItems(items: StoredItem[]) {
  const tx = (await db()).transaction('items', 'readwrite')
  for (const it of items) tx.store.put(it)
  await tx.done
}

export async function deleteItem(id: string) {
  await (await db()).delete('items', id)
}

export async function getMeta<T>(key: string): Promise<T | undefined> {
  return (await db()).get('meta', key)
}

export async function setMeta(key: string, value: unknown) {
  await (await db()).put('meta', value, key)
}

export async function delMeta(key: string) {
  await (await db()).delete('meta', key)
}

export async function allFonts(): Promise<FontRecord[]> {
  return (await db()).getAll('fonts')
}

export async function putFont(f: FontRecord) {
  await (await db()).put('fonts', f)
}

export async function deleteFont(name: string) {
  await (await db()).delete('fonts', name)
}
