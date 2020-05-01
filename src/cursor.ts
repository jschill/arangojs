/**
 * `import type { ArrayCursor } from "arangojs/cursor";`
 *
 * TODO
 *
 * @packageDocumentation
 */
import { LinkedList } from "x3-linkedlist";
import { Database } from "./database";
import { Dict } from "./util/types";

/**
 * TODO
 */
export class ArrayCursor<T = any> {
  protected _db: Database;
  protected _result: LinkedList<any>;
  protected _count?: number;
  protected _extra: {
    warnings: { code: number; message: string }[];
    plan?: any;
    profile?: any;
    stats?: Dict<any>;
  };
  protected _hasMore: boolean;
  protected _id: string | undefined;
  protected _host?: number;
  protected _allowDirtyRead?: boolean;

  /**
   * TODO
   *
   * @hidden
   */
  constructor(
    db: Database,
    body: {
      extra: any;
      result: T[];
      hasMore: boolean;
      id: string;
      count: number;
    },
    host?: number,
    allowDirtyRead?: boolean
  ) {
    this._db = db;
    this._result = new LinkedList(body.result);
    this._id = body.id;
    this._hasMore = Boolean(body.id && body.hasMore);
    this._host = host;
    this._count = body.count;
    this._extra = body.extra;
    this._allowDirtyRead = allowDirtyRead;
  }

  protected async _drain(): Promise<ArrayCursor<T>> {
    await this._more();
    if (!this.hasMore) return this;
    return this._drain();
  }

  protected async _more(): Promise<void> {
    if (!this.hasMore) return;
    const res = await this._db.request({
      method: "PUT",
      path: `/_api/cursor/${this._id}`,
      host: this._host,
      allowDirtyRead: this._allowDirtyRead,
    });
    this._result.push(...res.body.result);
    this._hasMore = res.body.hasMore;
  }

  /**
   * TODO
   */
  get extra() {
    return this._extra;
  }

  /**
   * The total number of documents in the query result. Only available if the
   * `count` option was used.
   */
  get count(): number | undefined {
    return this._count;
  }

  /**
   * Whether the cursor has any remaining batches that haven't yet been
   * fetched. If set to `false`, all batches have been fetched and no
   * additional requests to the server will be made when consuming any
   * remaining items from this cursor.
   */
  get hasMore(): boolean {
    return this._hasMore;
  }

  /**
   * Whether the cursor has more values. If set to `false`, the cursor has
   * already been depleted and contains no more items.
   */
  get hasNext(): boolean {
    return this.hasMore || Boolean(this._result.length);
  }

  /**
   * Enables use with `for await` to deplete the cursor by asynchronously
   * yielding every value in the cursor's remaining result set.
   *
   * **Note**: If the result set spans multiple batches, any remaining batches
   * will only be fetched on demand. Depending on the cursor's TTL and the
   * processing speed, this may result in the server discarding the cursor
   * before it is fully depleted.
   *
   * @example
   * ```js
   * const cursor = await db.query(aql`
   *   FOR user IN users
   *   FILTER user.isActive
   *   RETURN user
   * `);
   * for await (const user of cursor) {
   *   console.log(user.email, user.isAdmin);
   * }
   * ```
   */
  async *[Symbol.asyncIterator](): AsyncGenerator<T, undefined, undefined> {
    while (this.hasNext) {
      yield this.next() as Promise<T>;
    }
    return undefined;
  }

  /**
   * Depletes the cursor, then returns an array containing all values in the
   * cursor's remaining result list.
   *
   * @example
   * ```js
   * const cursor = await db.query(aql`FOR x IN 1..5 RETURN x`);
   * const result = await cursor.all(); // [1, 2, 3, 4, 5]
   * console.log(cursor.hasNext); // false
   */
  async all(): Promise<T[]> {
    await this._drain();
    const result = [...this._result.values()];
    this._result.clear();
    return result;
  }

  /**
   * Advances the cursor and returns the next value in the cursor's remaining
   * result list, or `undefined` if the cursor has been depleted.
   *
   * **Note**: If the result set spans multiple batches, any remaining batches
   * will only be fetched on demand. Depending on the cursor's TTL and the
   * processing speed, this may result in the server discarding the cursor
   * before it is fully depleted.
   *
   * @example
   * ```js
   * const cursor = await db.query(aql`FOR x IN 1..3 RETURN x`);
   * const one = await cursor.next(); // 1
   * const two = await cursor.next(); // 2
   * const three = await cursor.next(); // 3
   * const empty = await cursor.next(); // undefined
   * ```
   */
  async next(): Promise<T | undefined> {
    while (!this._result.length && this.hasMore) {
      await this._more();
    }
    if (!this._result.length) {
      return undefined;
    }
    return this._result.shift();
  }

  /**
   * Advances the cursor and returns all remaining values in the cursor's
   * current batch. If the current batch has already been exhausted, fetches
   * the next batch from the server and returns it, or `undefined` if the
   * cursor has been depleted.
   *
   * **Note**: If the result set spans multiple batches, any remaining batches
   * will only be fetched on demand. Depending on the cursor's TTL and the
   * processing speed, this may result in the server discarding the cursor
   * before it is fully depleted.
   *
   * @example
   * ```js
   * const cursor = await db.query(
   *   aql`FOR i IN 1..10 RETURN i`,
   *   { batchSize: 5 }
   * );
   * const firstBatch = await cursor.nextBatch(); // [1, 2, 3, 4, 5]
   * await cursor.next(); // 6
   * const lastBatch = await cursor.nextBatch(); // [7, 8, 9, 10]
   * console.log(cursor.hasNext); // false
   * ```
   */
  async nextBatch(): Promise<any[] | undefined> {
    while (!this._result.length && this.hasMore) {
      await this._more();
    }
    if (!this._result.length) {
      return undefined;
    }
    const result = [...this._result.values()];
    this._result.clear();
    return result;
  }

  /**
   * TODO
   */
  async each(
    fn: (value: T, index: number, self: ArrayCursor<T>) => boolean | void
  ): Promise<boolean> {
    let index = 0;
    while (this._result.length || this.hasMore) {
      let result;
      while (this._result.length) {
        result = fn(this._result.shift()!, index, this);
        index++;
        if (result === false) return result;
      }
      if (this.hasMore) await this._more();
    }
    return true;
  }

  /**
   * TODO
   */
  async map<U = any>(
    fn: (value: T, index: number, self: ArrayCursor<T>) => U
  ): Promise<U[]> {
    let index = 0;
    let result: any[] = [];
    while (this._result.length || this.hasMore) {
      while (this._result.length) {
        result.push(fn(this._result.shift()!, index, this));
        index++;
      }
      if (this.hasMore) await this._more();
    }
    return result;
  }

  /**
   * TODO
   */
  async reduce<U>(
    fn: (accu: U, value: T, index: number, self: ArrayCursor<T>) => U,
    accu?: U
  ): Promise<U | undefined> {
    let index = 0;
    if (!this._result.length) return accu;
    if (accu === undefined) {
      if (!this._result.length && !this.hasMore) {
        await this._more();
      }
      accu = this._result.shift() as any;
      index += 1;
    }
    while (this._result.length || this.hasMore) {
      while (this._result.length) {
        accu = fn(accu!, this._result.shift()!, index, this);
        index++;
      }
      if (this.hasMore) await this._more();
    }
    return accu;
  }

  /**
   * TODO
   */
  async kill(): Promise<void> {
    if (!this.hasMore) return undefined;
    return this._db.request(
      {
        method: "DELETE",
        path: `/_api/cursor/${this._id}`,
      },
      () => {
        this._hasMore = false;
        return undefined;
      }
    );
  }
}
