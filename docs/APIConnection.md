<p align="center"><br><img src="https://user-images.githubusercontent.com/236501/85893648-1c92e880-b7a8-11ea-926d-95355b8175c7.png" width="128" height="128" /></p>
<h2 align="center">API CONNECTION DOCUMENTATION</h2>
<p align="center"><strong><code>@capacitor-community/sqlite</code></strong></p>
<p align="center">
  SQLite Connection Wrapper</p>

## Methods Index

<docgen-index>

* [`initWebStore()`](#initwebstore)
* [`saveToStore(...)`](#savetostore)
* [`getFromLocalDiskToStore(...)`](#getfromlocaldisktostore)
* [`saveToLocalDisk(...)`](#savetolocaldisk)
* [`importDatabase(...)`](#importdatabase)
* [`getWebStoreInfo()`](#getwebstoreinfo)
* [`echo(...)`](#echo)
* [`isSecretStored()`](#issecretstored)
* [`setEncryptionSecret(...)`](#setencryptionsecret)
* [`changeEncryptionSecret(...)`](#changeencryptionsecret)
* [`clearEncryptionSecret()`](#clearencryptionsecret)
* [`checkEncryptionSecret(...)`](#checkencryptionsecret)
* [`addUpgradeStatement(...)`](#addupgradestatement)
* [`createConnection(...)`](#createconnection)
* [`isConnection(...)`](#isconnection)
* [`retrieveConnection(...)`](#retrieveconnection)
* [`retrieveAllConnections()`](#retrieveallconnections)
* [`closeConnection(...)`](#closeconnection)
* [`closeAllConnections()`](#closeallconnections)
* [`checkConnectionsConsistency()`](#checkconnectionsconsistency)
* [`getNCDatabasePath(...)`](#getncdatabasepath)
* [`createNCConnection(...)`](#createncconnection)
* [`closeNCConnection(...)`](#closencconnection)
* [`isNCConnection(...)`](#isncconnection)
* [`retrieveNCConnection(...)`](#retrievencconnection)
* [`importFromJson(...)`](#importfromjson)
* [`isJsonValid(...)`](#isjsonvalid)
* [`copyFromAssets(...)`](#copyfromassets)
* [`getFromHTTPRequest(...)`](#getfromhttprequest)
* [`isDatabaseEncrypted(...)`](#isdatabaseencrypted)
* [`isInConfigEncryption()`](#isinconfigencryption)
* [`isInConfigBiometricAuth()`](#isinconfigbiometricauth)
* [`isDatabase(...)`](#isdatabase)
* [`isNCDatabase(...)`](#isncdatabase)
* [`getDatabaseList()`](#getdatabaselist)
* [`getMigratableDbList(...)`](#getmigratabledblist)
* [`addSQLiteSuffix(...)`](#addsqlitesuffix)
* [`deleteOldDatabases(...)`](#deleteolddatabases)
* [`moveDatabasesAndAddSuffix(...)`](#movedatabasesandaddsuffix)
* [Interfaces](#interfaces)
* [Type Aliases](#type-aliases)

</docgen-index>

## API Connection Wrapper

<docgen-api class="custom-css">
<!--Update the source file JSDoc comments and rerun docgen to update the docs below-->

SQLiteConnection Interface

### initWebStore()

```typescript
initWebStore() => Promise<void>
```

Init the web store

Mandatory on the web platform and must resolve before the first `createConnection`. It starts
the plugin's SQLite worker, selects the durability tier, and on its very first run imports any
database left behind by the previous jeep-sqlite implementation. Rejects when another tab of
the same origin already owns the store.

**Since:** 3.2.3-1

--------------------


### saveToStore(...)

```typescript
saveToStore(database: string) => Promise<void>
```

Save the database to the web store

A no-op when the web store is on OPFS, and the real flush of the database image to IndexedDB
on the fallback tier. Safe and cheap to call unconditionally.

| Param          | Type                |
| -------------- | ------------------- |
| **`database`** | <code>string</code> |

**Since:** 3.2.3-1

--------------------


### getFromLocalDiskToStore(...)

```typescript
getFromLocalDiskToStore(overwrite: boolean) => Promise<void>
```

Get database from local disk and save it to store

| Param           | Type                 | Description |
| --------------- | -------------------- | ----------- |
| **`overwrite`** | <code>boolean</code> | : boolean   |

**Since:** 4.6.3

--------------------


### saveToLocalDisk(...)

```typescript
saveToLocalDisk(database: string) => Promise<void>
```

Save database to local disk

| Param          | Type                | Description |
| -------------- | ------------------- | ----------- |
| **`database`** | <code>string</code> | : string    |

**Since:** 4.6.3

--------------------


### importDatabase(...)

```typescript
importDatabase(database: string, source: capSQLiteImportSource, overwrite?: boolean | undefined, totalBytes?: number | undefined) => Promise<capSQLiteImportDatabaseResult>
```

Import a database from bytes the caller supplies (Web only)

| Param            | Type                                                                    | Description                                                      |
| ---------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------- |
| **`database`**   | <code>string</code>                                                     |                                                                  |
| **`source`**     | <code><a href="#capsqliteimportsource">capSQLiteImportSource</a></code> | <a href="#uint8array">Uint8Array</a>, Blob or ReadableStream     |
| **`overwrite`**  | <code>boolean</code>                                                    | replace an existing database of that name                        |
| **`totalBytes`** | <code>number</code>                                                     | total length, for progress when the source cannot report its own |

**Returns:** <code>Promise&lt;<a href="#capsqliteimportdatabaseresult">capSQLiteImportDatabaseResult</a>&gt;</code>

**Since:** 8.2.0

--------------------


### getWebStoreInfo()

```typescript
getWebStoreInfo() => Promise<capWebStoreInfo>
```

Report how the web store is persisting data, and how much room it has (Web only)

**Returns:** <code>Promise&lt;<a href="#capwebstoreinfo">capWebStoreInfo</a>&gt;</code>

**Since:** 8.2.0

--------------------


### echo(...)

```typescript
echo(value: string) => Promise<capEchoResult>
```

Echo a value

| Param       | Type                |
| ----------- | ------------------- |
| **`value`** | <code>string</code> |

**Returns:** <code>Promise&lt;<a href="#capechoresult">capEchoResult</a>&gt;</code>

**Since:** 2.9.0 refactor

--------------------


### isSecretStored()

```typescript
isSecretStored() => Promise<capSQLiteResult>
```

Check if a secret is stored

**Returns:** <code>Promise&lt;<a href="#capsqliteresult">capSQLiteResult</a>&gt;</code>

**Since:** 3.0.0-beta.13

--------------------


### setEncryptionSecret(...)

```typescript
setEncryptionSecret(passphrase: string) => Promise<void>
```

Set a passphrase in a secure store

| Param            | Type                |
| ---------------- | ------------------- |
| **`passphrase`** | <code>string</code> |

**Since:** 3.0.0-beta.13

--------------------


### changeEncryptionSecret(...)

```typescript
changeEncryptionSecret(passphrase: string, oldpassphrase: string) => Promise<void>
```

Change the passphrase in a secure store

| Param               | Type                |
| ------------------- | ------------------- |
| **`passphrase`**    | <code>string</code> |
| **`oldpassphrase`** | <code>string</code> |

**Since:** 3.0.0-beta.13

--------------------


### clearEncryptionSecret()

```typescript
clearEncryptionSecret() => Promise<void>
```

Clear the passphrase in a secure store

**Since:** 3.5.1

--------------------


### checkEncryptionSecret(...)

```typescript
checkEncryptionSecret(passphrase: string) => Promise<capSQLiteResult>
```

Check the passphrase stored in a secure store

| Param            | Type                |
| ---------------- | ------------------- |
| **`passphrase`** | <code>string</code> |

**Returns:** <code>Promise&lt;<a href="#capsqliteresult">capSQLiteResult</a>&gt;</code>

**Since:** 4.6.1

--------------------


### addUpgradeStatement(...)

```typescript
addUpgradeStatement(database: string, upgrade: capSQLiteVersionUpgrade[]) => Promise<void>
```

Add the upgrade Statement for database version upgrading

| Param          | Type                                   |
| -------------- | -------------------------------------- |
| **`database`** | <code>string</code>                    |
| **`upgrade`**  | <code>capSQLiteVersionUpgrade[]</code> |

**Since:** 5.6.4

--------------------


### createConnection(...)

```typescript
createConnection(database: string, encrypted: boolean, mode: string, version: number, readonly: boolean) => Promise<SQLiteDBConnection>
```

Create a connection to a database

| Param           | Type                 | Description                                   |
| --------------- | -------------------- | --------------------------------------------- |
| **`database`**  | <code>string</code>  |                                               |
| **`encrypted`** | <code>boolean</code> | not available on the web platform             |
| **`mode`**      | <code>string</code>  |                                               |
| **`version`**   | <code>number</code>  |                                               |
| **`readonly`**  | <code>boolean</code> | supported on every platform, the web included |

**Returns:** <code>Promise&lt;SQLiteDBConnection&gt;</code>

**Since:** 2.9.0 refactor

--------------------


### isConnection(...)

```typescript
isConnection(database: string, readonly: boolean) => Promise<capSQLiteResult>
```

Check if a connection exists

| Param          | Type                 |
| -------------- | -------------------- |
| **`database`** | <code>string</code>  |
| **`readonly`** | <code>boolean</code> |

**Returns:** <code>Promise&lt;<a href="#capsqliteresult">capSQLiteResult</a>&gt;</code>

**Since:** 3.0.0-beta.5

--------------------


### retrieveConnection(...)

```typescript
retrieveConnection(database: string, readonly: boolean) => Promise<SQLiteDBConnection>
```

Retrieve an existing database connection

| Param          | Type                 |
| -------------- | -------------------- |
| **`database`** | <code>string</code>  |
| **`readonly`** | <code>boolean</code> |

**Returns:** <code>Promise&lt;SQLiteDBConnection&gt;</code>

**Since:** 2.9.0 refactor

--------------------


### retrieveAllConnections()

```typescript
retrieveAllConnections() => Promise<Map<string, SQLiteDBConnection>>
```

Retrieve all database connections

**Returns:** <code>Promise&lt;<a href="#map">Map</a>&lt;string, SQLiteDBConnection&gt;&gt;</code>

**Since:** 2.9.0 refactor

--------------------


### closeConnection(...)

```typescript
closeConnection(database: string, readonly: boolean) => Promise<void>
```

Close a database connection

| Param          | Type                 |
| -------------- | -------------------- |
| **`database`** | <code>string</code>  |
| **`readonly`** | <code>boolean</code> |

**Since:** 2.9.0 refactor

--------------------


### closeAllConnections()

```typescript
closeAllConnections() => Promise<void>
```

Close all database connections

**Since:** 2.9.0 refactor

--------------------


### checkConnectionsConsistency()

```typescript
checkConnectionsConsistency() => Promise<capSQLiteResult>
```

Check the consistency between Js Connections
and Native Connections
if inconsistency all connections are removed

**Returns:** <code>Promise&lt;<a href="#capsqliteresult">capSQLiteResult</a>&gt;</code>

**Since:** 3.0.0-beta.10

--------------------


### getNCDatabasePath(...)

```typescript
getNCDatabasePath(path: string, database: string) => Promise<capNCDatabasePathResult>
```

get a non-conformed database path

| Param          | Type                |
| -------------- | ------------------- |
| **`path`**     | <code>string</code> |
| **`database`** | <code>string</code> |

**Returns:** <code>Promise&lt;<a href="#capncdatabasepathresult">capNCDatabasePathResult</a>&gt;</code>

**Since:** 3.3.3-1

--------------------


### createNCConnection(...)

```typescript
createNCConnection(databasePath: string, version: number) => Promise<SQLiteDBConnection>
```

Create a non-conformed database connection

| Param              | Type                |
| ------------------ | ------------------- |
| **`databasePath`** | <code>string</code> |
| **`version`**      | <code>number</code> |

**Returns:** <code>Promise&lt;SQLiteDBConnection&gt;</code>

**Since:** 3.3.3-1

--------------------


### closeNCConnection(...)

```typescript
closeNCConnection(databasePath: string) => Promise<void>
```

Close a non-conformed database connection

| Param              | Type                |
| ------------------ | ------------------- |
| **`databasePath`** | <code>string</code> |

**Since:** 3.3.3-1

--------------------


### isNCConnection(...)

```typescript
isNCConnection(databasePath: string) => Promise<capSQLiteResult>
```

Check if a non-conformed databaseconnection exists

| Param              | Type                |
| ------------------ | ------------------- |
| **`databasePath`** | <code>string</code> |

**Returns:** <code>Promise&lt;<a href="#capsqliteresult">capSQLiteResult</a>&gt;</code>

**Since:** 3.3.3-1

--------------------


### retrieveNCConnection(...)

```typescript
retrieveNCConnection(databasePath: string) => Promise<SQLiteDBConnection>
```

Retrieve an existing non-conformed database connection

| Param              | Type                |
| ------------------ | ------------------- |
| **`databasePath`** | <code>string</code> |

**Returns:** <code>Promise&lt;SQLiteDBConnection&gt;</code>

**Since:** 3.3.3-1

--------------------


### importFromJson(...)

```typescript
importFromJson(jsonstring: string) => Promise<capSQLiteChanges>
```

Import a database From a JSON

| Param            | Type                | Description |
| ---------------- | ------------------- | ----------- |
| **`jsonstring`** | <code>string</code> | string      |

**Returns:** <code>Promise&lt;<a href="#capsqlitechanges">capSQLiteChanges</a>&gt;</code>

**Since:** 2.9.0 refactor

--------------------


### isJsonValid(...)

```typescript
isJsonValid(jsonstring: string) => Promise<capSQLiteResult>
```

Check the validity of a JSON Object

| Param            | Type                | Description |
| ---------------- | ------------------- | ----------- |
| **`jsonstring`** | <code>string</code> | string      |

**Returns:** <code>Promise&lt;<a href="#capsqliteresult">capSQLiteResult</a>&gt;</code>

**Since:** 2.9.0 refactor

--------------------


### copyFromAssets(...)

```typescript
copyFromAssets(overwrite?: boolean | undefined) => Promise<void>
```

Copy databases from public/assets/databases folder to application databases folder

| Param           | Type                 | Description   |
| --------------- | -------------------- | ------------- |
| **`overwrite`** | <code>boolean</code> | since 3.2.5-2 |

**Since:** 2.9.0 refactor

--------------------


### getFromHTTPRequest(...)

```typescript
getFromHTTPRequest(url?: string | undefined, overwrite?: boolean | undefined) => Promise<void>
```

| Param           | Type                 |
| --------------- | -------------------- |
| **`url`**       | <code>string</code>  |
| **`overwrite`** | <code>boolean</code> |

**Since:** 4.1.1

--------------------


### isDatabaseEncrypted(...)

```typescript
isDatabaseEncrypted(database: string) => Promise<capSQLiteResult>
```

Check if a SQLite database is encrypted

| Param          | Type                |
| -------------- | ------------------- |
| **`database`** | <code>string</code> |

**Returns:** <code>Promise&lt;<a href="#capsqliteresult">capSQLiteResult</a>&gt;</code>

**Since:** 4.6.2-2

--------------------


### isInConfigEncryption()

```typescript
isInConfigEncryption() => Promise<capSQLiteResult>
```

Check encryption value in capacitor.config

**Returns:** <code>Promise&lt;<a href="#capsqliteresult">capSQLiteResult</a>&gt;</code>

**Since:** 4.6.2-2

--------------------


### isInConfigBiometricAuth()

```typescript
isInConfigBiometricAuth() => Promise<capSQLiteResult>
```

Check encryption value in capacitor.config

**Returns:** <code>Promise&lt;<a href="#capsqliteresult">capSQLiteResult</a>&gt;</code>

**Since:** 4.6.2-2

--------------------


### isDatabase(...)

```typescript
isDatabase(database: string) => Promise<capSQLiteResult>
```

Check if a database exists

| Param          | Type                |
| -------------- | ------------------- |
| **`database`** | <code>string</code> |

**Returns:** <code>Promise&lt;<a href="#capsqliteresult">capSQLiteResult</a>&gt;</code>

**Since:** 3.0.0-beta.5

--------------------


### isNCDatabase(...)

```typescript
isNCDatabase(databasePath: string) => Promise<capSQLiteResult>
```

Check if a non conformed database exists

| Param              | Type                |
| ------------------ | ------------------- |
| **`databasePath`** | <code>string</code> |

**Returns:** <code>Promise&lt;<a href="#capsqliteresult">capSQLiteResult</a>&gt;</code>

**Since:** 3.3.3-1

--------------------


### getDatabaseList()

```typescript
getDatabaseList() => Promise<capSQLiteValues>
```

Get the database list

**Returns:** <code>Promise&lt;<a href="#capsqlitevalues">capSQLiteValues</a>&gt;</code>

**Since:** 3.0.0-beta.5

--------------------


### getMigratableDbList(...)

```typescript
getMigratableDbList(folderPath?: string | undefined) => Promise<capSQLiteValues>
```

Get the Migratable database list

| Param            | Type                | Description                                  |
| ---------------- | ------------------- | -------------------------------------------- |
| **`folderPath`** | <code>string</code> | : string // only iOS & Android since 3.2.4-2 |

**Returns:** <code>Promise&lt;<a href="#capsqlitevalues">capSQLiteValues</a>&gt;</code>

**Since:** 3.0.0-beta.5

--------------------


### addSQLiteSuffix(...)

```typescript
addSQLiteSuffix(folderPath?: string | undefined, dbNameList?: string[] | undefined) => Promise<void>
```

Add SQLIte Suffix to existing databases

| Param            | Type                  | Description   |
| ---------------- | --------------------- | ------------- |
| **`folderPath`** | <code>string</code>   |               |
| **`dbNameList`** | <code>string[]</code> | since 3.2.4-1 |

**Since:** 3.0.0-beta.5

--------------------


### deleteOldDatabases(...)

```typescript
deleteOldDatabases(folderPath?: string | undefined, dbNameList?: string[] | undefined) => Promise<void>
```

Delete Old Cordova databases

| Param            | Type                  | Description   |
| ---------------- | --------------------- | ------------- |
| **`folderPath`** | <code>string</code>   |               |
| **`dbNameList`** | <code>string[]</code> | since 3.2.4-1 |

**Since:** 3.0.0-beta.5

--------------------


### moveDatabasesAndAddSuffix(...)

```typescript
moveDatabasesAndAddSuffix(folderPath?: string | undefined, dbNameList?: string[] | undefined) => Promise<void>
```

Moves databases to the location the plugin can read them, and adds sqlite suffix
This resembles calling addSQLiteSuffix and deleteOldDatabases, but it is more performant as it doesn't copy but moves the files

| Param            | Type                  | Description                                                                                                                                                       |
| ---------------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`folderPath`** | <code>string</code>   | the origin from where to move the databases                                                                                                                       |
| **`dbNameList`** | <code>string[]</code> | the names of the databases to move, check out the getMigratableDbList to get a list, an empty list will result in copying all the databases with '.db' extension. |

--------------------


### Interfaces


#### capSQLiteImportDatabaseResult

| Prop           | Type                 | Description                                                |
| -------------- | -------------------- | ---------------------------------------------------------- |
| **`database`** | <code>string</code>  | The database that was imported                             |
| **`bytes`**    | <code>number</code>  | Bytes read from the source                                 |
| **`replaced`** | <code>boolean</code> | "true" when an existing database of that name was replaced |


#### Uint8Array

A typed array of 8-bit unsigned integer values. The contents are initialized to 0. If the
requested number of bytes could not be allocated an exception is raised.

| Prop                    | Type                                                        | Description                                                                  |
| ----------------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------- |
| **`BYTES_PER_ELEMENT`** | <code>number</code>                                         | The size in bytes of each element in the array.                              |
| **`buffer`**            | <code><a href="#arraybufferlike">ArrayBufferLike</a></code> | The <a href="#arraybuffer">ArrayBuffer</a> instance referenced by the array. |
| **`byteLength`**        | <code>number</code>                                         | The length in bytes of the array.                                            |
| **`byteOffset`**        | <code>number</code>                                         | The offset in bytes of the array.                                            |
| **`length`**            | <code>number</code>                                         | The length of the array.                                                     |

| Method             | Signature                                                                                                                                                                      | Description                                                                                                                                                                                                                                 |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **copyWithin**     | (target: number, start: number, end?: number \| undefined) =&gt; this                                                                                                          | Returns the this object after copying a section of the array identified by start and end to the same array starting at position target                                                                                                      |
| **every**          | (predicate: (value: number, index: number, array: <a href="#uint8array">Uint8Array</a>) =&gt; unknown, thisArg?: any) =&gt; boolean                                            | Determines whether all the members of an array satisfy the specified test.                                                                                                                                                                  |
| **fill**           | (value: number, start?: number \| undefined, end?: number \| undefined) =&gt; this                                                                                             | Returns the this object after filling the section identified by start and end with value                                                                                                                                                    |
| **filter**         | (predicate: (value: number, index: number, array: <a href="#uint8array">Uint8Array</a>) =&gt; any, thisArg?: any) =&gt; <a href="#uint8array">Uint8Array</a>                   | Returns the elements of an array that meet the condition specified in a callback function.                                                                                                                                                  |
| **find**           | (predicate: (value: number, index: number, obj: <a href="#uint8array">Uint8Array</a>) =&gt; boolean, thisArg?: any) =&gt; number \| undefined                                  | Returns the value of the first element in the array where predicate is true, and undefined otherwise.                                                                                                                                       |
| **findIndex**      | (predicate: (value: number, index: number, obj: <a href="#uint8array">Uint8Array</a>) =&gt; boolean, thisArg?: any) =&gt; number                                               | Returns the index of the first element in the array where predicate is true, and -1 otherwise.                                                                                                                                              |
| **forEach**        | (callbackfn: (value: number, index: number, array: <a href="#uint8array">Uint8Array</a>) =&gt; void, thisArg?: any) =&gt; void                                                 | Performs the specified action for each element in an array.                                                                                                                                                                                 |
| **indexOf**        | (searchElement: number, fromIndex?: number \| undefined) =&gt; number                                                                                                          | Returns the index of the first occurrence of a value in an array.                                                                                                                                                                           |
| **join**           | (separator?: string \| undefined) =&gt; string                                                                                                                                 | Adds all the elements of an array separated by the specified separator string.                                                                                                                                                              |
| **lastIndexOf**    | (searchElement: number, fromIndex?: number \| undefined) =&gt; number                                                                                                          | Returns the index of the last occurrence of a value in an array.                                                                                                                                                                            |
| **map**            | (callbackfn: (value: number, index: number, array: <a href="#uint8array">Uint8Array</a>) =&gt; number, thisArg?: any) =&gt; <a href="#uint8array">Uint8Array</a>               | Calls a defined callback function on each element of an array, and returns an array that contains the results.                                                                                                                              |
| **reduce**         | (callbackfn: (previousValue: number, currentValue: number, currentIndex: number, array: <a href="#uint8array">Uint8Array</a>) =&gt; number) =&gt; number                       | Calls the specified callback function for all the elements in an array. The return value of the callback function is the accumulated result, and is provided as an argument in the next call to the callback function.                      |
| **reduce**         | (callbackfn: (previousValue: number, currentValue: number, currentIndex: number, array: <a href="#uint8array">Uint8Array</a>) =&gt; number, initialValue: number) =&gt; number |                                                                                                                                                                                                                                             |
| **reduce**         | &lt;U&gt;(callbackfn: (previousValue: U, currentValue: number, currentIndex: number, array: <a href="#uint8array">Uint8Array</a>) =&gt; U, initialValue: U) =&gt; U            | Calls the specified callback function for all the elements in an array. The return value of the callback function is the accumulated result, and is provided as an argument in the next call to the callback function.                      |
| **reduceRight**    | (callbackfn: (previousValue: number, currentValue: number, currentIndex: number, array: <a href="#uint8array">Uint8Array</a>) =&gt; number) =&gt; number                       | Calls the specified callback function for all the elements in an array, in descending order. The return value of the callback function is the accumulated result, and is provided as an argument in the next call to the callback function. |
| **reduceRight**    | (callbackfn: (previousValue: number, currentValue: number, currentIndex: number, array: <a href="#uint8array">Uint8Array</a>) =&gt; number, initialValue: number) =&gt; number |                                                                                                                                                                                                                                             |
| **reduceRight**    | &lt;U&gt;(callbackfn: (previousValue: U, currentValue: number, currentIndex: number, array: <a href="#uint8array">Uint8Array</a>) =&gt; U, initialValue: U) =&gt; U            | Calls the specified callback function for all the elements in an array, in descending order. The return value of the callback function is the accumulated result, and is provided as an argument in the next call to the callback function. |
| **reverse**        | () =&gt; <a href="#uint8array">Uint8Array</a>                                                                                                                                  | Reverses the elements in an Array.                                                                                                                                                                                                          |
| **set**            | (array: <a href="#arraylike">ArrayLike</a>&lt;number&gt;, offset?: number \| undefined) =&gt; void                                                                             | Sets a value or an array of values.                                                                                                                                                                                                         |
| **slice**          | (start?: number \| undefined, end?: number \| undefined) =&gt; <a href="#uint8array">Uint8Array</a>                                                                            | Returns a section of an array.                                                                                                                                                                                                              |
| **some**           | (predicate: (value: number, index: number, array: <a href="#uint8array">Uint8Array</a>) =&gt; unknown, thisArg?: any) =&gt; boolean                                            | Determines whether the specified callback function returns true for any element of an array.                                                                                                                                                |
| **sort**           | (compareFn?: ((a: number, b: number) =&gt; number) \| undefined) =&gt; this                                                                                                    | Sorts an array.                                                                                                                                                                                                                             |
| **subarray**       | (begin?: number \| undefined, end?: number \| undefined) =&gt; <a href="#uint8array">Uint8Array</a>                                                                            | Gets a new <a href="#uint8array">Uint8Array</a> view of the <a href="#arraybuffer">ArrayBuffer</a> store for this array, referencing the elements at begin, inclusive, up to end, exclusive.                                                |
| **toLocaleString** | () =&gt; string                                                                                                                                                                | Converts a number to a string by using the current locale.                                                                                                                                                                                  |
| **toString**       | () =&gt; string                                                                                                                                                                | Returns a string representation of an array.                                                                                                                                                                                                |
| **valueOf**        | () =&gt; <a href="#uint8array">Uint8Array</a>                                                                                                                                  | Returns the primitive value of the specified object.                                                                                                                                                                                        |


#### ArrayLike

| Prop         | Type                |
| ------------ | ------------------- |
| **`length`** | <code>number</code> |


#### ArrayBufferTypes

Allowed <a href="#arraybuffer">ArrayBuffer</a> types for the buffer of an ArrayBufferView and related Typed Arrays.

| Prop              | Type                                                |
| ----------------- | --------------------------------------------------- |
| **`ArrayBuffer`** | <code><a href="#arraybuffer">ArrayBuffer</a></code> |


#### ArrayBuffer

Represents a raw buffer of binary data, which is used to store data for the
different typed arrays. ArrayBuffers cannot be read from or written to directly,
but can be passed to a typed array or DataView Object to interpret the raw
buffer as needed.

| Prop             | Type                | Description                                                                     |
| ---------------- | ------------------- | ------------------------------------------------------------------------------- |
| **`byteLength`** | <code>number</code> | Read-only. The length of the <a href="#arraybuffer">ArrayBuffer</a> (in bytes). |

| Method    | Signature                                                                               | Description                                                     |
| --------- | --------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| **slice** | (begin: number, end?: number \| undefined) =&gt; <a href="#arraybuffer">ArrayBuffer</a> | Returns a section of an <a href="#arraybuffer">ArrayBuffer</a>. |


#### capWebStoreInfo

| Prop                 | Type                               | Description                                                                                                     |
| -------------------- | ---------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| **`tier`**           | <code>1 \| 2</code>                | 1 when databases are files in the Origin Private File System, 2 when they are whole-file images in IndexedDB    |
| **`persistence`**    | <code>'opfs' \| 'indexeddb'</code> | Where the bytes rest                                                                                            |
| **`sqliteVersion`**  | <code>string</code>                | The SQLite library version the engine reports                                                                   |
| **`poolName`**       | <code>string</code>                | The VFS pool name. Part of the on-disk contract: changing it orphans stored databases.                          |
| **`directory`**      | <code>string</code>                | The OPFS directory holding the pool                                                                             |
| **`fallbackReason`** | <code>string</code>                | Why tier 2 was selected. Absent on tier 1.                                                                      |
| **`quota`**          | <code>number</code>                | Origin storage quota in bytes. Absent where navigator.storage.estimate is not implemented, iOS 16.4 among them. |
| **`usage`**          | <code>number</code>                | Origin storage usage in bytes. Absent under the same conditions as "quota".                                     |


#### capEchoResult

| Prop        | Type                | Description     |
| ----------- | ------------------- | --------------- |
| **`value`** | <code>string</code> | String returned |


#### capSQLiteResult

| Prop         | Type                 | Description                                   |
| ------------ | -------------------- | --------------------------------------------- |
| **`result`** | <code>boolean</code> | result set to true when successful else false |


#### capSQLiteVersionUpgrade

| Prop             | Type                  |
| ---------------- | --------------------- |
| **`toVersion`**  | <code>number</code>   |
| **`statements`** | <code>string[]</code> |


#### Map

| Prop       | Type                |
| ---------- | ------------------- |
| **`size`** | <code>number</code> |

| Method      | Signature                                                                                                      |
| ----------- | -------------------------------------------------------------------------------------------------------------- |
| **clear**   | () =&gt; void                                                                                                  |
| **delete**  | (key: K) =&gt; boolean                                                                                         |
| **forEach** | (callbackfn: (value: V, key: K, map: <a href="#map">Map</a>&lt;K, V&gt;) =&gt; void, thisArg?: any) =&gt; void |
| **get**     | (key: K) =&gt; V \| undefined                                                                                  |
| **has**     | (key: K) =&gt; boolean                                                                                         |
| **set**     | (key: K, value: V) =&gt; this                                                                                  |


#### capNCDatabasePathResult

| Prop       | Type                | Description     |
| ---------- | ------------------- | --------------- |
| **`path`** | <code>string</code> | String returned |


#### capSQLiteChanges

| Prop          | Type                                        | Description                               |
| ------------- | ------------------------------------------- | ----------------------------------------- |
| **`changes`** | <code><a href="#changes">Changes</a></code> | a returned <a href="#changes">Changes</a> |


#### Changes

| Prop          | Type                | Description                                          |
| ------------- | ------------------- | ---------------------------------------------------- |
| **`changes`** | <code>number</code> | the number of changes from an execute or run command |
| **`lastId`**  | <code>number</code> | the lastId created from a run command                |
| **`values`**  | <code>any[]</code>  | values when RETURNING                                |


#### capSQLiteValues

| Prop         | Type               | Description                                                                              |
| ------------ | ------------------ | ---------------------------------------------------------------------------------------- |
| **`values`** | <code>any[]</code> | the data values list as an Array iOS the first row is the returned ios_columns name list |


### Type Aliases


#### capSQLiteImportSource

Anything `importDatabase` will read bytes from.

A `ReadableStream` is read on demand and never buffered whole, which is what makes a large
download affordable. A `Blob` is sliced as it goes, so a file-backed Blob is never fully
realised. A <a href="#uint8array">`Uint8Array`</a> is already in memory and is handed over in chunks for uniformity.

<code><a href="#uint8array">Uint8Array</a> | Blob | ReadableStream&lt;<a href="#uint8array">Uint8Array</a>&gt;</code>


#### ArrayBufferLike

<code>ArrayBufferTypes[keyof ArrayBufferTypes]</code>

</docgen-api>
