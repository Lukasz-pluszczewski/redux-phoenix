import _ from 'lodash';
import moment from 'moment';

export const REHYDRATE = '@@REHYDRATE';

/**
 * transform state according to passed transformation
 *
 * @param {object} map transformation
 * @param {object} state State from redux
 * @return {object} Transformed state
 */
function transform(map, state) {
  const result = {};
  _.forEach(map, (value, key) => {
    if (typeof value === 'function') {
      const transformation = value(key, _.get(state, key), state);
      if (transformation.targetKey && _.has(transformation, 'targetValue')) {
        _.set(result, transformation.targetKey, transformation.targetValue);
      }
      if (_.has(transformation, 'sourceValue')) {
        _.set(result, key, transformation.sourceValue);
      }
    } else {
      _.set(result, value, _.get(state, key));
    }
  });
  return _.merge({}, state, result);
}

/**
 * get functions from migrations list that should be run before rehydrating
 *
 * @param {array} appliedMigrations names of migrations that has been succesfully applied
 * @param {array} migrations list of migrations that should be run on old versions of state
 * @return {array} array of functions from migrations that should be run
 */
export function getMigrationsToRun(appliedMigrations = [], migrations) {
  const migrationsToApply = migrations.filter(migration => migration.up);

  let theSameIndex = 0;
  let iterate = true;

  while (iterate && theSameIndex < appliedMigrations.length) {
    if (migrationsToApply[theSameIndex] && migrationsToApply[theSameIndex].name === appliedMigrations[theSameIndex]) {
      theSameIndex++;
    } else {
      iterate = false;
    }
  }

  const migrationsToRun = [];

  for (let index = appliedMigrations.length - 1; index >= theSameIndex; index--) {
    const migrationToRevert = migrations.find(({ name }) => name === appliedMigrations[index]);
    if (migrationToRevert && migrationToRevert.down) {
      migrationsToRun.push(migrationToRevert.down);
    }
  }

  for (let index = theSameIndex; index < migrationsToApply.length; index++) {
    migrationsToRun.push(migrationsToApply[index].up);
  }

  return migrationsToRun;
}

/**
 * Persist store
 *
 * @export
 * @param {object} store Redux Store
 * @param {object} config Configuration object
 * @return {Promise<object>} Persisted Store
 */
export default function persistStore(store, {
  key = 'redux',
  whitelist = null,
  blacklist = null,
  storage = window.localStorage,
  expireDate = null,
  serialize = JSON.stringify,
  deserialize = JSON.parse,
  map = {},
  disabled = false,
  throttle = 0,
  migrations = null,
} = {}) {
  return Promise.resolve(storage.getItem(key)).then(persistedJson => {
    if (disabled) {
      return store;
    }
    const persistedValue = deserialize(persistedJson);
    const { persistedState, saveDate, migrations: appliedMigrations } = persistedValue || {};
    let state = persistedState;
    if (expireDate && moment(saveDate).add(...expireDate).isBefore(moment())) {
      state = null;
    }

    if (state && migrations) {
      const migrationsToRun = getMigrationsToRun(appliedMigrations, migrations);
      state = migrationsToRun.reduce((state, migration) => migration(state), state);
    }

    const persistedStateToMerge = whitelist
      ? _.omit(_.pick(state, whitelist), blacklist)
      : _.omit(state, blacklist);

    store.dispatch({
      type: REHYDRATE,
      payload: persistedStateToMerge,
    });

    const saveState = () => {
      const state = transform(map, store.getState());
      const subset = whitelist
        ? _.omit(_.pick(state, whitelist), blacklist)
        : _.omit(state, blacklist);

      storage.setItem(key, serialize({ persistedState: subset, saveDate: moment().valueOf() }));
    };

    const throttledSubscribe = _.throttle(saveState, throttle, {
      trailing: true,
    });
    store.subscribe(throttle > 0 ? throttledSubscribe : saveState);
    return store;
  });
}

/**
 * Enhancer
 *
 * @export
 * @param {function} next callback
 * @return {function} enhancer
 */
export const autoRehydrate = next => (reducer, initialState, enhancer) => {
  if (typeof initialState === 'function' && typeof enhancer === 'undefined') {
    enhancer = initialState;
    initialState = undefined; // eslint-disable-line no-undefined
  }
  function rehydrateReducer(state, action) {
    if (action.type === REHYDRATE) {
      return reducer(_.merge({}, state, action.payload), action);
    }
    return reducer(state, action);
  }
  return next(rehydrateReducer, initialState, enhancer);
};
