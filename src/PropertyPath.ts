import { produce } from 'immer'

// MARK: Key Path

export type KeyPath<Root, Value> = {
    get: (root: Root) => Value
    set: (root: Root, value: Value) => Root
}

export function keyPath<
    Root,
    K1 extends keyof Root
>(...path: [K1]): KeyPath<Root, Root[K1]>

export function keyPath<
    Root,
    K1 extends keyof Root,
    K2 extends keyof Root[K1]
>(...path: [K1, K2]): KeyPath<Root, Root[K1][K2]>

export function keyPath<
    Root,
    K1 extends keyof Root,
    K2 extends keyof Root[K1],
    K3 extends keyof Root[K1][K2]
>(...path: [K1, K2, K3]): KeyPath<Root, Root[K1][K2][K3]>

export function keyPath<
    Root,
    K1 extends keyof Root,
    K2 extends keyof Root[K1],
    K3 extends keyof Root[K1][K2],
    K4 extends keyof Root[K1][K2][K3]
>(...path: [K1, K2, K3, K4]): KeyPath<Root, Root[K1][K2][K3][K4]>

export function keyPath<
    Root,
    K1 extends keyof Root,
    K2 extends keyof Root[K1],
    K3 extends keyof Root[K1][K2],
    K4 extends keyof Root[K1][K2][K3],
    K5 extends keyof Root[K1][K2][K3][K4],
>(...path: [K1, K2, K3, K4, K5]): KeyPath<Root, Root[K1][K2][K3][K4][K5]>

export function keyPath<
    Root,
    P extends [...(string | number)[]]
>(...path: P): KeyPath<Root, any> {
    return {
        get: (root: any): any => path.reduce((acc, key) => acc && acc[key], root),
        set: (root: any, value: any): any => {
            return produce(root, (draft: any) => {
                let target = draft
                for (let i = 0; i < path.length - 1; i++) {
                    if (target[path[i]] === undefined) {
                        throw new Error(`Property not found: ${path[i]}`)
                    }
                    target = target[path[i]]
                }
                const lastKey = path[path.length - 1]
                target[lastKey] = value
            })
        },
    }
}

// MARK: Case Path

export type WithKindValue<K extends string, V> = {
    kind: K
    value: V
}

export type AnyKindValue = WithKindValue<any, any>

export type CasePath<Root, Value> = {
    extract: (root: Root) => Value | null
    embed: (value: Value) => Root
}

export function casePath<Root extends AnyKindValue, K extends Root['kind']>(
    kind: K
): CasePath<Root, Extract<Root, { kind: K }>['value']> {
    return {
        extract: (root: Root): Extract<Root, { kind: K }>['value'] | null => {
            if (root.kind === kind) {
                return root.value as any
            }
            return null
        },
        embed: (value: Extract<Root, { kind: K }>['value']): Root => {
            return { kind, value } as Root
        }
    }
}

// MARK: Utilities

// Function to determine if the path is a KeyPath
export function isKeyPath<Root, Value>(path: KeyPath<Root, Value> | CasePath<Root, Value>): path is KeyPath<Root, Value> {
    return 'get' in path && 'set' in path
}

// Function to determine if the path is a CasePath
export function isCasePath<Root, Value>(path: KeyPath<Root, Value> | CasePath<Root, Value>): path is CasePath<Root, Value> {
    return 'extract' in path && 'embed' in path
}