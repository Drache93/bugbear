class LabeledList {
  constructor() {
    this._items = []
  }
  push(label, value) {
    this._items.push({ label, value })
  }
  get length() {
    return this._items.length
  }
}

module.exports = LabeledList
