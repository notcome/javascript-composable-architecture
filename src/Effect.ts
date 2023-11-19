import { immerable, produce } from 'immer'

export class EffectContext {
    onCancellation?: () => void

    private _isCancelled: boolean = false

    get isCancelled(): boolean {
        return this._isCancelled
    }

    cancel() {
        if (this._isCancelled) {
            return
        }

        this._isCancelled = true
        if (this.onCancellation) {
            this.onCancellation()
        }
    }
}

export type EffectNode<Action> = {
    kind: 'cancel-scope'
    scope: string[]
} | {
    kind: 'cancel-id'
    id: string
} | {
    kind: 'action'
    value: Action
} | {
    kind: 'promise',
    id?: string,
    value: (context: EffectContext) => Promise<Action>
} | {
    kind: 'generator'
    id?: string
    value: (context: EffectContext) => AsyncGenerator<Action, void, undefined>
}

function mapEffectNode<Action, NewAction>(node: EffectNode<Action>, transform: (action: Action) => NewAction): EffectNode<NewAction> {
    switch (node.kind) {
        case 'cancel-scope':
        case 'cancel-id':
            return node as EffectNode<NewAction>
        case 'action':
            return {
                ...node,
                value: transform(node.value)
            }
        case 'promise':
            return {
                ...node,
                value: async (context: EffectContext) => {
                    const result = await node.value(context)
                    return transform(result)
                }
            }
        case 'generator':
            return {
                ...node,
                value: async function* (context: EffectContext) {
                    for await (const output of node.value(context)) {
                        if (context.isCancelled) {
                            return
                        }
                        yield transform(output)
                    }
                }
            }
    }
}


export class Effect<Action> {
    [immerable] = true

    node?: EffectNode<Action>
    children: Effect<Action>[] = []
    scope: string[] = []

    map<NewAction>(transform: (action: Action) => NewAction): Effect<NewAction> {
        const effect = new Effect<NewAction>()
        if (this.node) {
            effect.node = mapEffectNode(this.node, transform)
        }
        effect.children = this.children.map(x => x.map(transform))
        return effect
    }

    cancellationScope(scope: string): Effect<Action> {
        return produce(this, draft => {
            draft.scope.unshift(scope)
        })   
    }

    static none = new Effect<any>()

    static cancelScope(scope: string[]): Effect<any> {
        const effect = new Effect()
        effect.node = {
            kind: 'cancel-scope',
            scope
        }
        return effect
    }

    static cancelId(id: string): Effect<any> {
        const effect = new Effect()
        effect.node = {
            kind: 'cancel-id',
            id
        }
        return effect
    }

    static merge<Action>(...effects: Effect<Action>[]): Effect<Action> {
        const nonEmptyEffects = effects.filter(x => !x.isEmpty)
        if (nonEmptyEffects.length == 0) {
            return Effect.none
        }
        if (nonEmptyEffects.length == 1) {
            return nonEmptyEffects[0]
        }
        const tree = new Effect<Action>()
        tree.children = nonEmptyEffects
        return tree
    }

    get isEmpty(): boolean {
        if (this === Effect.none) {
            return true
        }
        if (this.node) {
            return false
        }
        for (const child of this.children) {
            if (!child.isEmpty) {
                return false
            }
        }
        return true
    }
}

export type ResolvedEffect<Action> = {
    kind: 'cancel-scope'
    scope: string[]
} | {
    kind: 'cancel-id'
    id: string
} | {
    kind: 'action'
    value: Action
} | {
    kind: 'long-running'
    id?: string
    scope: string[]
    context: EffectContext
    start: () => AsyncGenerator<Action, void, undefined>
}

function resolveEffectNode<Action>(effectNode: EffectNode<Action>, scope: string[]): ResolvedEffect<Action> {
    switch (effectNode.kind) {
        case 'cancel-scope':
            return {
                kind: 'cancel-scope',
                scope: scope.concat(effectNode.scope)
            }
        case 'cancel-id':
            return effectNode
        case 'action':
            return effectNode
        default:
            const context = new EffectContext()
            async function* start(): AsyncGenerator<Action, void, undefined> {
                if (effectNode.kind == 'promise') {
                    const result = await effectNode.value(context)
                    if (!context.isCancelled) {
                        yield result
                    }
                } else if (effectNode.kind == 'generator') {
                    for await (const result of effectNode.value(context)) {
                        if (!context.isCancelled) {
                            yield result
                        }
                    }
                }
            }

            const retval: ResolvedEffect<Action> = {
                kind: 'long-running',
                scope, context, start
            }

            if (effectNode.id) {
                retval.id = effectNode.id
            }
            return retval
    }
}

export function resolveEffect<Action>(effect: Effect<Action>, scope: string[]): ResolvedEffect<Action>[] {
    if (effect.isEmpty) {
        return []
    }
    const list: ResolvedEffect<Action>[] = []
    scope = scope.concat(effect.scope)
    if (effect.node) {
        list.push(resolveEffectNode(effect.node, scope))
    }
    for (const child of effect.children) {
        list.push(...resolveEffect(child, scope))
    }
    return list
}

export class EffectContextTree {
    contexts: EffectContext[] = []
    children?: Map<string, EffectContextTree>

    cancelSelf() {
        for (const context of this.contexts) {
            context.cancel()
            this.contexts = []
        }
        if (!this.children) {
            return
        }
        for (const [_, child] of this.children) {
            child.cancelSelf()
        }
        delete this.children
    }

    cancel(scope: string[]) {
        if (scope.length === 0) {
            this.cancelSelf()
            return
        }
        if (!this.children) {
            return
        }

        const head = scope[0]
        const child = this.children.get(head)
        if (!child) {
            return
        }
        const rest = scope.slice(1)
        child.cancel(rest)
        if (rest.length === 0) {
            this.children.delete(head)
        }
    }

    add(context: EffectContext, scope: string[]) {
        if (context.isCancelled) {
            return
        }

        if (scope.length === 0) {
            this.contexts.push(context)
            return
        }

        if (!this.children) {
            this.children = new Map()
        }

        const head = scope[0]
        let child = this.children.get(head)
        if (!child) {
            child = new EffectContextTree()
            this.children.set(head, child)
        }
        child.add(context, scope.slice(1))
    }
}