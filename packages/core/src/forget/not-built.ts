/** Thrown by a forget piece that is not built yet (red-first stubs, brief 021). */
export class NotBuilt extends Error {
  constructor(what: string) {
    super(`not built: ${what}`);
    this.name = "NotBuilt";
  }
}
