# dmn-ts

Execute DMN as normal ESM. Each `.dmn` file is transpiled at build time into a standalone TypeScript package — one function per decision, FEEL expressions inlined as plain JS, with a small runtime providing FEEL semantics.

### Example 

```
npm run run -- examples/loan-approval.dmn -o examples/out/loan-approval

# the output is a regular npm package
cd examples/out/loan-approval
npm install && npm run build
node -e "import('./dist/index.js').then(m => console.log(
  m.decisions['Approval']({ 'Credit Score': 780, 'Annual Income': 100000, 'Requested Amount': 30000 })
))"
```

## Conformance

`npm run tck:all` walks the [DMN TCK](https://github.com/dmn-tck/tck) (495 cases / 9 674 tests) and writes a report under `out/all/`.
`npm run tck:run <case-dir> <generated-pkg>` runs the fixtures from a single case against an already-built package — useful when iterating on one model without rebuilding the whole suite.

## Inspiration

Same strategy as [jDMN](https://github.com/goldmansachs/jdmn) (DMN → Java); this is the JavaScript equivalent.
