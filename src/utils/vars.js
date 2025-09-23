// src/utils/vars.js
const store = new Map();

module.exports = {
  setVar: (key, value) => store.set(key, value),
  getVar: (key) => store.get(key),
  getAll: () => Object.fromEntries(store.entries()),
};