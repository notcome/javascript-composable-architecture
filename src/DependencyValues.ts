import { Draft, produce } from 'immer'

export type DependencyValuesStorage = {
    [key: symbol]: any
}

export class DependencyValues {
    storage: DependencyValuesStorage

    constructor(storage?: DependencyValuesStorage) {
        if (storage) {
            this.storage = storage
        } else {
            this.storage = {}
        }
    }

    mutating(body: (draft: Draft<DependencyValuesStorage>) => void): DependencyValues {
        return new DependencyValues(produce(this.storage, body))
    }
}
