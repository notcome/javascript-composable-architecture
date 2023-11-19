import { v4 as uuidv4 } from 'uuid'
import { EffectContext, EffectContextTree, ResolvedEffect, resolveEffect } from './Effect'
import { Reducer, run } from './Reducer'
import { DependencyValues } from './DependencyValues'

export interface Store<State, Action> {
    state: State
    send(action: Action): void
    subscribe(id: string, callback: (state: State) => void): void
    unsubscribe(id: string): void
}

export class RootStore<State, Action> implements Store<State, Action> {
    state: State
    reducer: Reducer<State, Action>
    namedEffects: Map<string, EffectContext> = new Map()
    effectTree = new EffectContextTree()

    callbacks: Map<string, (state: State) => void> = new Map()

    constructor(initialState: State, reducer: Reducer<State, Action>) {
        this.state = initialState
        this.reducer = reducer
    }

    send(action: Action) {
        const oldState = this.state

        const pendingActions: Action[] = [action]
        while (true) {
            const next = pendingActions.shift()
            if (!next) {
                break
            }
            this.processAction(next, pendingActions)
        }

        if (oldState === this.state) {
            return
        }
        for (const [_, callback] of this.callbacks) {
            callback(this.state)
        }      
    }

    private processAction(action: Action, pendingActions: Action[]) {
        const [newState, effect] = run(this.reducer, this.state, action, new DependencyValues())
        this.state = newState
        
        for (const x of resolveEffect(effect, [])) {
            this.processResolvedEffect(x, pendingActions)
        }
    }

    private processResolvedEffect(x: ResolvedEffect<Action>, pendingActions: Action[]) {
        switch (x.kind) {
            case 'cancel-scope':
                this.effectTree.cancel(x.scope)
                break
            case 'cancel-id':
                const context = this.namedEffects.get(x.id)
                context?.cancel()
                break
            case 'action':
                pendingActions.push(x.value)
                break
            case 'long-running':
                if (x.id) {
                    this.namedEffects.get(x.id)?.cancel()
                }
                this.effectTree.add(x.context, x.scope)
                const task = async () => {
                    for await (const action of x.start()) {
                        this.send(action)
                    }
                }
                task()
        }
    }

    subscribe(id: string, callback: (state: State) => void) {
        this.callbacks.set(id, callback)
    }

    unsubscribe(id: string) {
        this.callbacks.delete(id)
    }
}

export class ScopedStore<State, Action, LocalState, LocalAction> implements Store<LocalState, LocalAction> {
    rootStore: RootStore<State, Action>
    toLocalState: (state: State) => LocalState
    fromLocalAction: (localAction: LocalAction) => Action

    private id = uuidv4()

    constructor(rootStore: RootStore<State, Action>, toLocalState: (state: State) => LocalState, fromLocalAction: (localAction: LocalAction) => Action) {
        this.rootStore = rootStore
        this.toLocalState = toLocalState
        this.fromLocalAction = fromLocalAction
    }

    get state(): LocalState {
        return this.toLocalState(this.rootStore.state)
    }

    send(action: LocalAction) {
        this.rootStore.send(this.fromLocalAction(action))
    }

    subscribe(id: string, callback: (state: LocalState) => void) {
        let lastState: LocalState | null = null
        this.rootStore.subscribe(`${this.id}/${id}`, x => {
            const newState = this.toLocalState(x)
            if (newState === lastState) {
                return
            }
            lastState = newState
            callback(newState)
        })
    }

    unsubscribe(id: string) {
        this.rootStore.unsubscribe(`${this.id}/${id}`)
    }
}
