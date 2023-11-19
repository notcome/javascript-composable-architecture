import { v4 as uuidv4 } from 'uuid'
import React from 'react'
import { Store } from './Store'

export function useStore<State, Action>(store: Store<State, Action>): [State, (action: Action) => void] {
    const [state, setState] = React.useState(() => store.state)
    React.useEffect(() => {
        const id = uuidv4()
        store.subscribe(id, state => {
            setState(state)
        })

        return () => {
            store.unsubscribe(id)
        }
    }, [])
    return [state, action => store.send(action)]
}
