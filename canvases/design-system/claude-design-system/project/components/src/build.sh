#!/bin/sh
# Rebuild components/bundle.js from components/src. Run from components/.
set -e
NS=HalalGoesDesignSystem_d11a47
HEADER='/* @ds-bundle: {"format":4,"namespace":"HalalGoesDesignSystem_d11a47","components":[{"name":"Badge"},{"name":"Button"},{"name":"Card"},{"name":"Icon"},{"name":"IconButton"},{"name":"Countdown"},{"name":"DataTable"},{"name":"Price"},{"name":"Rating"},{"name":"StatusTimeline"},{"name":"Modal"},{"name":"Menu"},{"name":"Sheet"},{"name":"Toast"},{"name":"Checkbox"},{"name":"Input"},{"name":"Radio"},{"name":"SegmentedControl"},{"name":"Select"},{"name":"Switch"},{"name":"HalalBadge"},{"name":"HalalCertificationPanel"},{"name":"HalalChecklist"},{"name":"HalalShield"},{"name":"AppBar"},{"name":"BottomNav"}]} */'
npx -y esbuild@0.24.0 src/index.js --bundle --format=iife --global-name=$NS --target=es2019 \
  --jsx=transform --jsx-factory=React.createElement --jsx-fragment=React.Fragment \
  --alias:react=./src/react-shim.cjs --loader:.js=jsx --charset=utf8 --legal-comments=none \
  "--banner:js=$HEADER" --footer:js="window.$NS = $NS;" --outfile=bundle.js
# esbuild names React bindings `import_react*`; rename them so the classic script contains no
# `import` token at all, then verify the bundle rules (no import, no </script, no <!--, no eval).
node -e '
const fs=require("fs");let s=fs.readFileSync("bundle.js","utf8");
s=s.replace(/\bimport_react(\d*)\b/g,(m,d)=>"hgReact"+d);
fs.writeFileSync("bundle.js",s);
const bad=[/\bimport\b/,/<\/script/i,/<!--/,/\beval\s*\(/,/new Function/,/\bfetch\s*\(/];
const hit=bad.filter(r=>r.test(s));
if(hit.length){console.error("bundle rule violated:",hit.map(String));process.exit(1)}
console.log("bundle.js ok,",s.length,"bytes");'
