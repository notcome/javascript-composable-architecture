import { produce } from 'immer'
import { KeyPath, CasePath, isKeyPath, AnyKindValue } from './PropertyPath'
import { Effect } from './Effect'

type Foo = {
    userId: number
    name: string
}

function setNmae(foo: Foo, newName: string): Foo {
    return produce(foo, draft => {
        draft.name = newName
    })
}

type Writable<T> = T

export type Reducer<State, Action> = ComposedReducer<State, Action> | PrimitiveReducer<State, Action>

export interface ComposedReducer<State, Action> {
    body: Reducer<State, Action>
}

export interface PrimitiveReducer<State, Action> {
    reduce(state: Writable<State>, action: Action): Effect<Action>
}

export class EmptyReducer<State, Action> implements PrimitiveReducer<State, Action> {
    reduce(state: State, action: Action): Effect<Action> {
        return Effect.none
    }
}

export function isComposedReducer<State, Action>(reducer: Reducer<State, Action>): reducer is ComposedReducer<State, Action> {
    return 'body' in reducer
}

export function isPrimitiveReducer<State, Action>(reducer: Reducer<State, Action>): reducer is PrimitiveReducer<State, Action> {
    return !isComposedReducer(reducer)
}

function run<State, Action>(reducer: Reducer<State, Action>, state: State, action: Action): Effect<Action> {
    if (isComposedReducer(reducer)) {
        return run(reducer.body, state, action)
    } else {
        return reducer.reduce(state, action)
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

    reduce(state: ParentState, action: ParentAction): Effect<ParentAction> {
        if (isKeyPath(this.state)) {
            const childAction = this.action.extract(action)
            if (!childAction) {
                return Effect.none
            }
            const childEffect = run(this.child, this.state.get(state), childAction)
            return childEffect.map(x => this.action.embed(x))
        } else {
            const childState = this.state.extract(state)
            const childAction = this.action.extract(action)
            if (!childState || !childAction) {
                return Effect.none
            }

            // We assume sum state has the form { kind, value }
            const casted = state as AnyKindValue
            const childEffect = run(this.child, casted.value, childAction)
            return childEffect.map(x => this.action.embed(x))
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

    reduce(state: State, action: Action): Effect<Action> {
        const effects: Effect<Action>[] = []
        for (const reducer of this.reducers) {
            effects.push(run(reducer, state, action))
        }
        return Effect.merge(...effects)
    }
}


namespace SampleFeature {
    export type State = {
        count: number
        numberFactAlert?: string
    }

    export type Action = {
        kind: 'decrementButtonTapped'
    } | {
        kind: 'incrementButtonTapped'
    }
}

class SampleFeature implements Reducer<SampleFeature.State, SampleFeature.Action> {
    reduce(state: SampleFeature.State, action: SampleFeature.Action): Effect<SampleFeature.Action> {
        switch (action.kind) {
            case 'decrementButtonTapped':
                state.count -= 1
                break
            case 'incrementButtonTapped':
                state.count += 1
        }
        return Effect.none
    }   
}

function haveFun(foo: Foo, reducer: Reducer<Foo, null>) {
    produce(foo, draft => {
        reducer.reduce(draft, null)
    })
}

// namespace ReducerBuilder {
//     export function pullback
// }


function bar(effect: Effect<number>) {

}

bar(Effect.none)
