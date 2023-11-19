import { Draft, produce } from 'immer'
import { Effect } from './Effect'
import { KeyPath, CasePath, isKeyPath } from './PropertyPath'
import { DependencyValuesStorage, DependencyValues } from './DependencyValues'

export type Reducer<State, Action> = ComposedReducer<State, Action> | BasicReducer<State, Action> | PrimitiveReducer<State, Action>

export interface ComposedReducer<State, Action> {
    body: Reducer<State, Action>
}

export interface BasicReducer<State, Action> {
    reduce(state: Draft<State>, action: Action, dependencies: DependencyValues): Effect<Action>
}

export interface PrimitiveReducer<State, Action> {
    _reduce(state: State, action: Action, dependencies: DependencyValues): [State, Effect<Action>]
}

export class EmptyReducer<State, Action> implements PrimitiveReducer<State, Action> {
    _reduce(state: State, action: Action, dependencies: DependencyValues): [State, Effect<Action>] {
        return [state, Effect.none]
    }
}

export function isComposedReducer<State, Action>(reducer: Reducer<State, Action>): reducer is ComposedReducer<State, Action> {
    return 'body' in reducer
}

export function isBasicReducer<State, Action>(reducer: Reducer<State, Action>): reducer is BasicReducer<State, Action> {
    return 'reduce' in reducer
}

export function isPrimitiveReducer<State, Action>(reducer: Reducer<State, Action>): reducer is PrimitiveReducer<State, Action> {
    return '_reduce' in reducer
}

export function run<State, Action>(reducer: Reducer<State, Action>, state: State, action: Action, dependencies: DependencyValues): [State, Effect<Action>] {
    if (isComposedReducer(reducer)) {
        return run(reducer.body, state, action, dependencies)
    } else if (isPrimitiveReducer(reducer)) {
        return reducer._reduce(state, action, dependencies)
    } else {
        let effect: Effect<Action> = Effect.none
        const newState = produce(state, draft => {
            effect = reducer.reduce(draft, action, dependencies)
        })
        return [newState, effect]
    }
}

export class Scope<ParentState, ParentAction, LocalState, LocalAction> implements PrimitiveReducer<ParentState, ParentAction> {
    state: KeyPath<ParentState, LocalState> | CasePath<ParentState, LocalState>
    action: CasePath<ParentAction, LocalAction>
    child: Reducer<LocalState, LocalAction>

    constructor(state: KeyPath<ParentState, LocalState> | CasePath<ParentState, LocalState>, action: CasePath<ParentAction, LocalAction>, body: () => Reducer<LocalState, LocalAction>) {
        this.state = state
        this.action = action
        this.child = body()
    }

    _reduce(state: ParentState, action: ParentAction, dependencies: DependencyValues): [ParentState, Effect<ParentAction>] {
        if (isKeyPath(this.state)) {
            const childAction = this.action.extract(action)
            if (!childAction) {
                return [state, Effect.none]
            }
            const [childState, childEffect] = run(this.child, this.state.get(state), childAction, dependencies)
            const newState = this.state.set(state, childState)
            return [newState, childEffect.map(x => this.action.embed(x))]
        } else {
            const childState = this.state.extract(state)
            const childAction = this.action.extract(action)
            if (!childState || !childAction) {
                return [state, Effect.none]
            }

            const [newChildState, childEffect] = run(this.child, childState, childAction, dependencies)
            return [this.state.embed(newChildState), childEffect.map(x => this.action.embed(x))]
        }
    }
}

export class CombineReducers<State, Action> implements PrimitiveReducer<State, Action> {
    reducers: Reducer<State, Action>[]

    constructor(...reducers: Reducer<State, Action>[])
    constructor(build: () => Reducer<State, Action>[])

    constructor(...args: any[]) {
        if (args.length === 1 && typeof args[0] === 'function') {
            // Handle the closure case
            const build = args[0] as () => Reducer<State, Action>[]
            this.reducers = build()
        } else {
            this.reducers = args as Reducer<State, Action>[]
        }
    }

    _reduce(state: State, action: Action, dependencies: DependencyValues): [State, Effect<Action>] {
        const effects: Effect<Action>[] = []
        for (const reducer of this.reducers) {
            const [newState, newEffect] = run(reducer, state, action, dependencies)
            state = newState
            effects.push(newEffect)
        }
        return [state, Effect.merge(...effects)]
    }
}

export class ChainReducer<State, Action> implements ComposedReducer<State, Action> {
    body: Reducer<State, Action>

    constructor(body: Reducer<State, Action>) {
        this.body = body
    }

    ifLet<ChildState, ChildAction>(
        state: KeyPath<State, ChildState | undefined>, 
        action: CasePath<Action, ChildAction>, 
        id: (state: ChildState) => string, 
        child: () => Reducer<ChildState, ChildAction>
    ): ChainReducer<State, Action> {
        const raw = new _IfLetReducer(this.body, child(), state, action, id)
        return new ChainReducer(raw)
    }

    ifCaseLet<ChildState, ChildAction>(
        state: CasePath<State, ChildState>, 
        action: CasePath<Action, ChildAction>, 
        id: (state: ChildState) => string, 
        child: () => Reducer<ChildState, ChildAction>
    ): ChainReducer<State, Action> {
        const raw = new _IfCaseLetReducer(this.body, child(), state, action, id)
        return new ChainReducer(raw)
    }
}

class _IfLetReducer<State, Action, ChildState, ChildAction> implements PrimitiveReducer<State, Action> {
    parent: Reducer<State, Action>
    child: Reducer<ChildState, ChildAction>
    state: KeyPath<State, ChildState | undefined>
    action: CasePath<Action, ChildAction>
    id: (state: ChildState) => string

    constructor(parent: Reducer<State, Action>, child: Reducer<ChildState, ChildAction>, state: KeyPath<State, ChildState | undefined>, action: CasePath<Action, ChildAction>, id: (state: ChildState) => string) {
        this.parent = parent
        this.child = child
        this.state = state
        this.action = action
        this.id = id
    }

    _reduce(state: State, action: Action, dependencies: DependencyValues): [State, Effect<Action>] {
        const effects: Effect<Action>[] = []
        let pair = this.reduceChild(state, action, dependencies)
        state = pair[0]
        effects.push(pair[1])

        const oldChildId = this.getChildId(state)
        pair = run(this.parent, state, action, dependencies)
        state = pair[0]
        effects.push(pair[1])
        const newChildId = this.getChildId(state)

        if (oldChildId != newChildId && oldChildId !== null) {
            effects.push(Effect.cancelScope([oldChildId]))
        }
        return [state, Effect.merge(...effects)]
    }

    reduceChild(state: State, action: Action, dependencies: DependencyValues): [State, Effect<Action>] {
        const childAction = this.action.extract(action)
        if (!childAction) {
            return [state, Effect.none]
        }
        const childState = this.state.get(state)
        if (!childState) {
            console.warn('An action is sent to an empty state...')
            return [state, Effect.none]
        }

        const [newChildState, childEffect] = run(this.child, childState, childAction, dependencies)
        const newState = this.state.set(state, newChildState)
        const newEffect = childEffect
            .map(x => this.action.embed(x))
            .cancellationScope(this.id(newChildState))
        return [newState, childEffect.map(x => this.action.embed(x))]
    }

    getChildId(state: State): string | null {
        const childState = this.state.get(state)
        if (childState) {
            return this.id(childState)
        }
        return null
    }
}

class _IfCaseLetReducer<State, Action, ChildState, ChildAction> implements PrimitiveReducer<State, Action> {
    parent: Reducer<State, Action>
    child: Reducer<ChildState, ChildAction>
    state: CasePath<State, ChildState>
    action: CasePath<Action, ChildAction>
    id: (state: ChildState) => string

    constructor(parent: Reducer<State, Action>, child: Reducer<ChildState, ChildAction>, state: CasePath<State, ChildState>, action: CasePath<Action, ChildAction>, id: (state: ChildState) => string) {
        this.parent = parent
        this.child = child
        this.state = state
        this.action = action
        this.id = id
    }

    _reduce(state: State, action: Action, dependencies: DependencyValues): [State, Effect<Action>] {
        const effects: Effect<Action>[] = []
        let pair = this.reduceChild(state, action, dependencies)
        state = pair[0]
        effects.push(pair[1])

        const oldChildId = this.getChildId(state)
        pair = run(this.parent, state, action, dependencies)
        state = pair[0]
        effects.push(pair[1])
        const newChildId = this.getChildId(state)

        if (oldChildId != newChildId && oldChildId !== null) {
            effects.push(Effect.cancelScope([oldChildId]))
        }
        return [state, Effect.merge(...effects)]
    }

    reduceChild(state: State, action: Action, dependencies: DependencyValues): [State, Effect<Action>] {
        const childAction = this.action.extract(action)
        if (!childAction) {
            return [state, Effect.none]
        }
        const childState = this.state.extract(state)
        if (!childState) {
            console.warn('An action is sent to an empty state...')
            return [state, Effect.none]
        }

        const [newChildState, childEffect] = run(this.child, childState, childAction, dependencies)
        const newState = this.state.embed(newChildState)
        const newEffect = childEffect
            .map(x => this.action.embed(x))
            .cancellationScope(this.id(newChildState))
        return [newState, childEffect.map(x => this.action.embed(x))]
    }

    getChildId(state: State): string | null {
        const childState = this.state.extract(state)
        if (childState) {
            return this.id(childState)
        }
        return null
    }
}

class _DependencySettingReducer<State, Action> implements PrimitiveReducer<State, Action> {
    wrapped: Reducer<State, Action>
    updateDependencies: (draft: Draft<DependencyValuesStorage>) => void

    constructor(
        wrapped: Reducer<State, Action>,
        updateDependencies: (draft: Draft<DependencyValuesStorage>) => void
    ) {
        this.wrapped = wrapped
        this.updateDependencies = updateDependencies
    }

    _reduce(state: State, action: Action, dependencies: DependencyValues): [State, Effect<Action>] {
        const updated = dependencies.mutating(this.updateDependencies)
        return run(this.wrapped, state, action, updated)
    }
}
