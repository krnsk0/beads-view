// Build-time stub. Ink only touches react-devtools-core when DEV=true, but
// bun's compiler flattens the dynamic import, so the real package (which we
// don't want to ship) would be resolved eagerly. See scripts/build.ts.
export default {
  initialize() {},
  connectToDevTools() {},
};
