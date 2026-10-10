// Jest stand-in for `import '…/global.<theme>.css'`. Metro compiles that file through
// NativeWind; jest has no CSS pipeline, so tests that need the styles compile and register
// them explicitly (src/redesign/__tests__/DsButton.test.tsx).
module.exports = {};
