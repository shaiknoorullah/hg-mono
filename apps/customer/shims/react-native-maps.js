/**
 * Stub for the optional `react-native-maps` peer.
 *
 * `@hg/ui-native`'s `resolveNativeMaps()` treats "module present but missing MapView/Marker/
 * Polyline" exactly the same as "module absent" and returns `null`, which puts `MapView` on its
 * documented text-panel path. Exporting an empty object here is therefore not a workaround — it
 * is the input the component was designed against.
 */
module.exports = {};
