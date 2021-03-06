
import {
    SET,
    SET_REQUESTED,
    SET_PROFILE,
    LOGIN,
    LOGOUT,
    LOGIN_ERROR,
    PERMISSION_DENIED_ERROR,
    START,
    INIT_BY_PATH
//    NO_VALUE
} from './constants'

import { Promise } from 'es6-promise'
import _ from 'lodash'

const getWatchPath = (event, path) => event + ':' + ((getCleanPath(path).substring(0, 1) === '/') ? '' : '/') + getCleanPath(path)

const setWatcher = (firebase, event, path, ConnectId='Manual') => {
    const id = getWatchPath(event, path);

    firebase._.watchers[id] = firebase._.watchers[id] || {};

    if (Object.keys(firebase._.watchers[id]).includes(ConnectId)) {
        firebase._.watchers[id][ConnectId]++
    } else {
        firebase._.watchers[id][ConnectId] = 1
    }

    return firebase._.watchers[id]
}

const cleanOnceWatcher = (firebase, dispatch, event, path, ConnectId) => {
    const id = getWatchPath(event, path);

    if (firebase._.watchers[id]) {
        if (firebase._.watchers[id][ConnectId] <= 1) {
            delete firebase._.watchers[id][ConnectId];

            if (Object.keys(firebase._.watchers[id]).length === 0) {
                delete firebase._.watchers[id];
            }
        } else if (firebase._.watchers[id][ConnectId]) {
            firebase._.watchers[id][ConnectId]--
        }
    }

    if(firebase._.shouldClearAfterOnce[id]) {
        for (let clean of firebase._.shouldClearAfterOnce[id]) {
            firebase.database().ref().child(clean.path).off(clean.event);
            if(!clean.isSkipClean){
                dispatch({
                    type: INIT_BY_PATH,
                    path: clean.path
                })
            }
        }

        delete firebase._.shouldClearAfterOnce[id];
    }

    return firebase._.watchers[id]
}

const getWatcherCount = (firebase, event, path) => {
    const id = getWatchPath(event, path);
    const watchers = firebase._.watchers[id];

    return watchers && Object.keys(watchers).length
}

const getCleanPath = (path) => {
    let pathSplitted = path.split('#');
    return pathSplitted[0];
}

const unsetWatcher = (firebase, dispatch, event, path, ConnectId='Manual', isSkipClean=false, isNewQuery=false) => {
    const id = getWatchPath(event, path);
    const onceEvent = getWatchPath('once', path);
    path = path.split('#')[0]

    if ((firebase._.watchers[id] && firebase._.watchers[id][ConnectId] <= 1) || isNewQuery) {
        var aggregationId = getWatchPath('child_aggregation', path);

        if (firebase._.timeouts && firebase._.timeouts[aggregationId]) {
            clearTimeout(firebase._.timeouts[aggregationId]);
            firebase._.timeouts[aggregationId] = undefined;
        }

        delete firebase._.watchers[id][ConnectId];

        const countWatchers = Object.keys(firebase._.watchers[id]).length;

        if (countWatchers === 0 || isNewQuery) {
            countWatchers === 0 && delete firebase._.watchers[id];

            if (event!='once'){
                if (!firebase._.watchers[onceEvent]) {
                    firebase.database().ref().child(path).off(event);
                    if(!isSkipClean){
                        dispatch({
                            type: INIT_BY_PATH,
                            path
                        })
                    }
                } else {
                    firebase._.shouldClearAfterOnce[onceEvent] = firebase._.shouldClearAfterOnce[onceEvent] || [];
                    firebase._.shouldClearAfterOnce[onceEvent].push({path, event, isSkipClean});
                }
            }
        }
    } else if (firebase._.watchers[id] && firebase._.watchers[id][ConnectId]) {
        firebase._.watchers[id][ConnectId]--
    }
}

export const isWatchPath = (firebase, dispatch, event, path) => {
    const id = getWatchPath(event, path);
    let isWatch = false;

    if (firebase._.watchers[id] > 0) {
        isWatch = true;
    }

    return isWatch;
}

function isNumeric(n) {
    return !isNaN(n - parseFloat(n));
}

export const watchEvent = (firebase, dispatch, event, path, ConnectId='Manual', isListenOnlyOnDelta=false,
                           isAggregation=false, setFunc=undefined, setOptions=undefined) => {
    const isNewQuery = path.includes('#')
    const isNewSet = setOptions !== undefined
    let queryParams = []

    if (isNewQuery) {
        let pathSplitted = path.split('#')
        path = pathSplitted[0]
        queryParams = pathSplitted[1].split('&')
    }

    const watchPath = path
    const counter = getWatcherCount(firebase, event, watchPath)

    if (counter > 0) {
        if (isNewQuery || isNewSet) {
            unsetWatcher(firebase, dispatch, event, path, ConnectId, false, isNewQuery || isNewSet)
        } else {
            setWatcher(firebase, event, watchPath, ConnectId)
            return
        }
    }

    setWatcher(firebase, event, watchPath, ConnectId)

    let query = firebase.database().ref().child(path)

    if (isNewQuery) {
        let doNotParse = false

        queryParams.forEach((param) => {
            param = param.split('=')
            switch (param[0]) {
                case 'doNotParse':
                    doNotParse = true
                    break
                case 'orderByValue':
                    query = query.orderByValue()
                    doNotParse = true
                    break
                case 'orderByPriority':
                    query = query.orderByPriority()
                    doNotParse = true
                    break
                case 'orderByKey':
                    query = query.orderByKey()
                    doNotParse = true
                    break
                case 'orderByChild':
                    query = query.orderByChild(param[1])
                    break
                case 'limitToFirst':
                    query = query.limitToFirst(parseInt(param[1]))
                    break
                case 'limitToLast':
                    query = query.limitToLast(parseInt(param[1]))
                    break
                case 'equalTo':
                    let equalToParam = (!doNotParse && isNumeric(param[1])) ? parseFloat(param[1]) || (param[1] === '0' ? 0 : param[1]) : param[1]
                    equalToParam = equalToParam === 'null' ? null : equalToParam
                    query = param.length === 3
                        ? query.equalTo(equalToParam, param[2])
                        : query.equalTo(equalToParam)
                    break
                case 'startAt':
                    let startAtParam = (!doNotParse && isNumeric(param[1])) ? parseFloat(param[1]) || (param[1] === '0' ? 0 : param[1]) : param[1]
                    startAtParam = startAtParam === 'null' ? null : startAtParam
                    query = param.length === 3
                        ? query.startAt(startAtParam, param[2])
                        : query.startAt(startAtParam)
                    break
                case 'endAt':
                    let endAtParam = (!doNotParse && isNumeric(param[1])) ? parseFloat(param[1]) || (param[1] === '0' ? 0 : param[1]) : param[1]
                    endAtParam = endAtParam === 'null' ? null : endAtParam
                    query = param.length === 3
                        ? query.endAt(endAtParam, param[2])
                        : query.endAt(endAtParam)
                    break
                default:
                    break
            } })
    }

    const runQuery = (q, e, p) => {
        dispatch({
            type: START,
            timestamp: Date.now(),
            requesting : true,
            requested : false,
            path
        })

        let aggregationId = getWatchPath('child_aggregation', path);

        if (e === 'once') {
            q.once('value')
                .then(snapshot => {
                    cleanOnceWatcher(firebase, dispatch, event, watchPath, ConnectId)
                    if (snapshot.val() !== null) {
                        if (setFunc) {
                            setFunc(snapshot, 'value', dispatch, setOptions);
                            dispatch({
                                type: SET_REQUESTED,
                                path: p,
                                key: snapshot.key,
                                timestamp: Date.now(),
                                requesting: false,
                                requested: true
                            });
                        } else {
                            dispatch({
                                type: SET,
                                path: p,
                                data: snapshot.val(),
                                snapshot,
                                key: snapshot.key,
                                timestamp: Date.now(),
                                requesting : false,
                                requested : true,
                                isChild: false,
                                isMixSnapshot: false,
                                isMergeDeep: false
                            })
                        }
                    }
                }, dispatchPermissionDeniedError)
        } else if (e === 'child_added' && isListenOnlyOnDelta) {
            let newItems = false;

            q.on(e, snapshot => {
                if (!newItems) return;

                if (isAggregation) {
                    if (!firebase._.timeouts[aggregationId]) {
                        firebase._.aggregatedData[aggregationId] = {}
                        firebase._.aggregatedSnapshot[aggregationId] = {}
                        firebase._.timeouts[aggregationId] = setTimeout(() => { dispatchBulk(p,aggregationId) }, 1000);
                    }

                    firebase._.aggregatedData[aggregationId][snapshot.key] = snapshot.val()
                    firebase._.aggregatedSnapshot[aggregationId][snapshot.key] = snapshot
                } else {
                    if (setFunc) {
                        setFunc(snapshot, 'child_added', dispatch, setOptions);
                        dispatch({
                            type: SET_REQUESTED,
                            path: p,
                            key: snapshot.key,
                            timestamp: Date.now(),
                            requesting: false,
                            requested: true
                        });
                    } else {
                        dispatch({
                            type: SET,
                            path: p,
                            data: snapshot.val(),
                            snapshot,
                            key: snapshot.key,
                            timestamp: Date.now(),
                            requesting : false,
                            requested : true,
                            isChild: true,
                            isMixSnapshot: true,
                            isMergeDeep: false
                        })
                    }
                }
            }, dispatchPermissionDeniedError)

            q.once('value')
                .then(snapshot => {
                    newItems = true;
                    if (snapshot.val() !== null) {
                        if (setFunc) {
                            setFunc(snapshot, 'value', dispatch, setOptions);
                            dispatch({
                                type: SET_REQUESTED,
                                path: p,
                                key: snapshot.key,
                                timestamp: Date.now(),
                                requesting: false,
                                requested: true
                            });
                        } else {
                            dispatch({
                                type: SET,
                                path: p,
                                data: snapshot.val(),
                                snapshot,
                                key: snapshot.key,
                                timestamp: Date.now(),
                                requesting : false,
                                requested : true,
                                isChild: false,
                                isMixSnapshot: true,
                                isMergeDeep: false
                            })
                        }
                    }
                }, dispatchPermissionDeniedError)
        } else {
            q.on(e, snapshot => {
                let data = (e === 'child_removed') ? '_child_removed' : snapshot.val();
                let tempSnapshot = (e === 'child_removed') ? '_child_removed' : snapshot;

                if (e !== 'value' && isAggregation) {
                    if (!firebase._.timeouts[aggregationId]) {
                        firebase._.aggregatedData[aggregationId] = {}
                        firebase._.aggregatedSnapshot[aggregationId] = {}
                        firebase._.timeouts[aggregationId] = setTimeout(() => { dispatchBulk(p,aggregationId) }, 1000);
                    }

                    firebase._.aggregatedData[aggregationId][snapshot.key] = data
                    firebase._.aggregatedSnapshot[aggregationId][snapshot.key] = tempSnapshot
                } else {
                    if (setFunc) {
                        setFunc(tempSnapshot, e, dispatch, setOptions);

                    } else {
                        dispatch({
                            type: SET,
                            path: p,
                            data,
                            snapshot: tempSnapshot,
                            key: snapshot.key,
                            timestamp: Date.now(),
                            requesting : false,
                            requested : true,
                            isChild: e !== 'value',
                            isMixSnapshot: isListenOnlyOnDelta,
                            isMergeDeep: false
                        })
                    }
                }
            }, (permError) => dispatchPermissionDeniedError(permError, p))
        }
    }

    const dispatchBulk = (p, aggregationId) => {
        if (setFunc) {
            setFunc(firebase._.aggregatedSnapshot[aggregationId], 'aggregated', dispatch, setOptions);
            dispatch({
                type: SET_REQUESTED,
                path: p,
                key: '_NONE',
                timestamp: Date.now(),
                requesting: false,
                requested: true
            });
        } else {
            dispatch({
                type: SET,
                path: p,
                data: firebase._.aggregatedData[aggregationId],
                snapshot: firebase._.aggregatedSnapshot[aggregationId],
                key: '_NONE',
                timestamp: Date.now(),
                requesting : false,
                requested : true,
                isChild: false,
                isMixSnapshot: true,
                isMergeDeep: true
            })
        }

        firebase._.timeouts[aggregationId] = undefined
    }

    const dispatchPermissionDeniedError = (permError, p) => {
        if (permError && permError.code === 'PERMISSION_DENIED' &&
            permError.message && !permError.message.includes('undefined')) {

            dispatch({
                type: PERMISSION_DENIED_ERROR,
                data: undefined,
                snapshot: {val:()=> undefined},
                path: p,
                timestamp: Date.now(),
                requesting : false,
                requested : true,
                permError
            })
        }

        throw permError
    }

    runQuery(query, event, path)
}

export const unWatchEvent = (firebase, dispatch, event, path, ConnectId, isSkipClean=false) => {
    unsetWatcher(firebase, dispatch, event, path, ConnectId, isSkipClean)
}

export const watchEvents = (firebase, dispatch, events, ConnectId='Manual') =>
    events.forEach(event => watchEvent(firebase, dispatch, event.name, event.path, ConnectId, event.isListenOnlyOnDelta, event.isAggregation, event.setFunc, event.setOptions))

export const unWatchEvents = (firebase, dispatch, events, ConnectId='Manual', isUnmount=false) =>
    events.forEach(event => unWatchEvent(firebase, dispatch, event.name, event.path, ConnectId, isUnmount ? false : event.isSkipClean))

const dispatchLoginError = (dispatch, authError) =>
    dispatch({
        type: LOGIN_ERROR,
        authError
    })



const dispatchLogin = (dispatch, auth) =>
    dispatch({
        type: LOGIN,
        auth,
        authError: null
    })

const unWatchUserProfile = (firebase) => {
    const authUid = firebase._.authUid
    const userProfile = firebase._.config.userProfile
    if (firebase._.profileWatch) {
        firebase.database().ref().child(`${userProfile}/${authUid}`).off('value', firebase._.profileWatch)
        firebase._.profileWatch = null
    }
}

const watchUserProfile = (dispatch, firebase) => {
    const authUid = firebase._.authUid
    const userProfile = firebase._.config.userProfile
    unWatchUserProfile(firebase)
    if (firebase._.config.userProfile) {
        firebase._.profileWatch = firebase.database().ref().child(`${userProfile}/${authUid}`).on('value', snap => {
            dispatch({
                type: SET_PROFILE,
                profile: snap.val()
            })
        })
    }
}

const createLoginPromise = (firebase, credentials) => {
    const auth = firebase.auth()
    if (_.isString(credentials)) {
        return auth.signInWithCustomToken(credentials)
    } else if (_.has(credentials, "email") && _.has(credentials, "password")) {
        return auth.signInWithEmailAndPassword(email, password)
    } else {
        return Promise.reject(new Error(`Malformed credentials or unsupported way of logging in: ${credentials}`))
    }
}

export const login = (dispatch, firebase, credentials) => {
    return new Promise((resolve, reject) => {
        dispatchLoginError(dispatch, null)

        createLoginPromise(firebase, credentials)
            .then(resolve)
            .catch(err => {
                dispatchLoginError(dispatch, err)
                reject(err)
            });
    })
}

export const init = (dispatch, firebase) => {
    firebase.auth().onAuthStateChanged(authData => {
        if (!authData) {
            return dispatch({type: LOGOUT})
        }

        firebase._.authUid = authData.uid
        watchUserProfile(dispatch, firebase)

        if (!!firebase._.firebasePendingEvents) {
            for (let key of Object.keys(firebase._.firebasePendingEvents)) {
                watchEvents(firebase, dispatch, firebase._.firebasePendingEvents[key], key);
            }

            firebase._.firebasePendingEvents = undefined
        }

        dispatchLogin(dispatch, authData)
    });

    // Run onAuthStateChanged if it exists in config
    if (firebase._.config.onAuthStateChanged) {
        firebase._.config.onAuthStateChanged(authData, firebase)
    }
}

export const logout = (dispatch, firebase, preserve = [], remove = []) => {
    firebase.auth().signOut()
    dispatch({type: LOGOUT, preserve, remove})
    firebase._.authUid = null
    unWatchUserProfile(firebase)
}

export const createUser = (dispatch, firebase, credentials, profile) =>
    new Promise((resolve, reject) => {
        dispatchLoginError(dispatch, null)
        firebase.auth().createUserWithEmailAndPassword(credentials.email, credentials.password)
            .then((userData) => {
                if (profile && firebase._.config.userProfile) {
                    firebase.database().ref().child(`${firebase._.config.userProfile}/${userData.uid}`).set(profile)
                }

                login(dispatch, firebase, credentials)
                    .then(() => resolve(userData.uid))
                    .catch(err => reject(err))
            })
            .catch(err => {
                dispatchLoginError(dispatch, err)
                return reject(err)
            })
    })

export const resetPassword = (dispatch, firebase, email) => {
    dispatchLoginError(dispatch, null)
    return firebase.auth().sendPasswordResetEmail(email).catch((err) => {
        if (err) {
            switch (err.code) {
                case 'INVALID_USER':
                    dispatchLoginError(dispatch, new Error('The specified user account does not exist.'))
                    break
                default:
                    dispatchLoginError(dispatch, err)
            }
            return
        }
    })
}

export default { watchEvents, unWatchEvents, init, logout, createUser, resetPassword, isWatchPath }
