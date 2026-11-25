export interface Folder {
  id: string
  name: string
  parentId: string | null
  created: number
  updated: number
  trashed?: number
}

export interface Note {
  id: string
  folderId: string | null
  title: string
  html: string
  text: string
  created: number
  updated: number
  pinned?: boolean
  trashed?: number
  paper?: Paper
}

export type Paper = 'plain' | 'lined' | 'grid' | 'dots'

export type View =
  | { name: 'library'; folderId: string | null }
  | { name: 'note'; id: string; dictate?: boolean; longRec?: boolean }
  | { name: 'settings'; section?: string }
  | { name: 'search' }
  | { name: 'trash' }
  | { name: 'about' }
  | { name: 'help' }

/** What is kept in IndexedDB: either the plain object or its encrypted form. */
export interface StoredItem {
  id: string
  kind: 'note' | 'folder'
  plain?: Note | Folder
  iv?: string
  data?: string
}
