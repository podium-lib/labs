# process-exception-handlers

Exception and signal handling with house cleaning hooks for graceful shutdown
for node.js

Catches unhandled exceptions and terminates the process.

Listens for a selection of signals, runs assigned house cleaning hooks and
terminates the process accordingly.

## Installation

```bash
$ npm install @podium/experimental-process-exception-handlers
```

## Example

Server is terminated due to an exception not being handled:

```js
const procExc = new ProcessExceptionHandlers();
procExc.set(next => {
    // some clean up code
    next();
});
throw new Error();
```

## Background

In node.js it is
[not recommended](https://nodejs.org/api/process.html#process_event_uncaughtexception)
to keep running if an uncaught exception occurred. One should log the exception,
take down the server, and start it again.

This is mostly due the the asynchronous nature of the language. This
[background information](http://debuggable.com/posts/node-js-dealing-with-uncaught-exceptions:4c933d54-1428-443c-928d-4e1ecbdd56cb)
is worth reading.

## API

This module is designed for global singleton use. You attach house cleaning
hooks in many places in your application but termination of your application is
done in one place. The house cleaning is intended to be used for cleaning up
critical stuff before a process is terminated. It is intended to be a tool for
trying to prevent dataloss when things go sour.

Examples of house cleaning:

-   Close down database connections
-   Close down open file writers
-   Close down backward http connections
-   Prevent http server from taking new http connections

All house cleaning should be completed within a given timeframe. If house
cleaning is not done before the end of this timeframe, the process will be
killed off and dataloss might occur. The timeframe is by default 2000ms. If
house cleaning is done within this timeframe, the process will be killed off at
the end of the last house cleaning operation.

### constructor(logger)

Creates a new instance of `ProcessExceptionHandlers`. An optional logger can be
passed to log events. Any logger that implements the methods trace, debug, info,
warn, error and fatal will suffice. If you do not pass a logger, nothing will be
logged.

```js
const procExc = new ProcessExceptionHandlers({
    trace() { ... },
    debug() { ... },
    info() { ... },
    warn() { ... },
    error() { ... },
    fatal() { ... },
});
```

`console` can also be passed.

Under the hood we use [abslog](https://www.npmjs.com/package/abslog) for
abstract logging. See that module for further information.

```js
const procExc = new ProcessExceptionHandlers(console);
```

### .set(callback, [immediate])

Append a house cleaning function which will run before a process is terminated.
The first function argument on the `callback` must be a `next` method which is
called inside the function. The second argument is a `boolean` saying if you
need to start shutdown immediately, or if you can wait for some time. This is
useful for a graceful shutdown - it allows you to give consumers some time
before rejecting new connections. In the case of a crash `immediate` will always
be true, meaning you should terminate as quickly as possible.

```js
const procExc = new ProcessExceptionHandlers();
const index = procExc.set(next => {
    // some clean up code
    next();
});
```

Upon termination of the process, all house cleaning hooks will be run in the
order they where appended.

Returns the id of the hook in the house cleaning registry.

### .remove(id)

Removes a house cleaning function from the house cleaning registry.

```js
const procExc = new ProcessExceptionHandlers();

const dbCleaner = procExc.set(next => {
    // some clean up code
    next();
});
const httpCleaner = procExc.set(next => {
    // some clean up code
    next();
});

const length = procExc.remove(httpCleaner);
```

Returns the number of items in the house cleaning registry.

### .timeout(time)

Sets a new timeout value in milliseconds. Default value is 2000 milliseconds.

```js
const procExc = new ProcessExceptionHandlers();
const timeout = procExc.timeout(1000);
```

If set to 0, timeout will be omitted on termination of the process. If any of
the house cleaning functions does not execute the `next()` method, the shutdown
process might halt.

Returns the new timeout in milliseconds.

### .terminate(onDone)

Executes all house cleaning functions in the house cleaning register in the
order they where appended. This does not alter the house cleaning register or
terminates the process. Takes an `onDone()` function as the first function
attribute which will run after all clean up hooks are executed or when timeout
occur.

```js
const procExc = new ProcessExceptionHandlers();

const dbCleaner = procExc.set(next => {
    // some clean up code
    next();
});
const httpCleaner = procExc.set(next => {
    // some clean up code
    next();
});

setTimeout(() => {
    procExc.terminate(() => {
        console.log('crime scene is now cleaned up');
    });
}, 6000);
```

### `.closeOnExit`

Sets up a hook to close an HTTP or Express server gracefully when the process
exits.

Handles generically an object with a `close` function on it, which invokes a
callback.

```js
const procExc = new ProcessExceptionHandlers();
const express = require('express');
const app = express();

const server = app.listen(3000);

// 5000 is the default, so option can be omitted
procExc.closeOnExit(server, { grace: 5000 });
```

### `.stopOnExit`

Same as `closeOnExit`, but calls `stop` instead of `close`.

In practice this expects that the server has been decorated with a stop method
using something like [stoppable](https://github.com/hunterloftis/stoppable) as a
vanilla http server or express server will not have this method.

## Metrics

Metrics are available from this module via the `.metrics` instance property.

```js
const procExc = new ProcessExceptionHandlers();
procExc.metrics.pipe(metricsConsumer);
```

See [`@metrics/client`](https://www.npmjs.com/package/@metrics/client) for
further information on usage.

## Process events

The module listens for the following process events:

### uncaughtException

`uncaughtException` - Triggered when exceptions are not caught. This usually
happens when a module is used and the calling code has not set up exception
handling.

The process will terminate with exit status 1 to indicate than an error
occurred.

### unhandledRejection

`unhandledRejection` events happen when promises are rejected and no rejection
handler was registered.

The process will terminate with exit status 1 to indicate that an error
occurred.

### SIGINT

`SIGINT` is a signal sent from the system to the node.js process indicating that
the node.js process should be terminated. `SIGINT` is usually triggered by a
user pressing Ctrl+C.

The process will terminate with exit status 0 to indicate that the process
exited normally.

### SIGTERM

`SIGTERM` is a signal sent from the system to the node.js process indicating
that the node.js process should be terminated. `SIGTERM` is mostly used by the
system to programmatically signal that a process should terminate itself. For
example `Upstart` sends `SIGTERM`for this purpose.

The process will terminate with exit status 0 to indicate than the process
exited normally.

### SIGHUP

`SIGHUP` is a signal sent from the system to the node.js process indicating that
the node.js process should be terminated. `SIGHUP` can occur when the
controlling terminal of the process is closed.

The process will terminate with exit status 0 to indicate that the process
exited normally.

## warning

This module will automatically log process warning events if a logger is
provided

## deprecation

This module will automatically log process deprecation events if a logger is
provided

## A word on exit codes

The module terminates programs with exit codes that the OS can use to decide
what to do next.

For example if the application is normally started and stopped by Upstart (on
Linux) and an `uncaughtException` happens, we want Upstart to restart the
application immediately.

By exiting with status 1, an error status, Upstart knows that something
unexpected happened and can restart the application.

We also want to be able to stop our application permanently. When we send a
`SIGTERM` to our application, it exits with exit code 0. Upstart can interpret
this to mean that the application exited on purpose and should not be restarted.
