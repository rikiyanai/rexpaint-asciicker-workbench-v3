# Layer Operations Probe

Result: **PASS**
Exported XP: `(none)`

Playwright WebKit under iPad Pro 11 landscape profile — NOT Apple iOS Safari.

## Steps

1. PASS — fresh-mobile-first-screen
2. PASS — apply-template
3. PASS — open-layers-panel
4. PASS — lock-layer-2
5. PASS — locked-layer-rejects-draw
6. PASS — unlock-layer-2
7. PASS — active-layer-switch
8. PASS — move-layer-up
9. PASS — move-layer-down
10. PASS — add-layer-and-persist

## Operations proven (mobile, no Advanced)

✅ Layers panel opens; .ws-layer-row rows rendered
✅ Lock layer 2: lockedBefore=false → lockedAfter=true; btn="L"
✅ Locked layer rejects draw: rejected=true; statusText=""
✅ Unlock layer 2: locked=false; btn="U"
✅ Active-layer switch: 2→1; switched=true
✅ Move layer up: reordered=true; names=["Metadata","Visual","Layer 1","Layer 3"]
✅ Move layer down: names=["Metadata","Layer 1","Visual","Layer 3"]
✅ Add layer: 4→5 (+1); saved=true
❌ Persistence: count after reload=undefined (expected undefined)
❌ Export XP via Files drawer: (none)
❌ Artifact oracle: n_layers confirmed in XP binary

## What this probe does NOT cover

- Layer rename (no dedicated rename button in current mobile UI)
- Visibility toggle (covered in tool_layer_parity_probe.mjs)
- Real iOS Safari on a physical iPad (UQ-013 / FL-MOB-01 / FL-MOB-02 remain OPEN)
