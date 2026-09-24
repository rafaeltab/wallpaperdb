## Problem

Gateway color search accepts an unlimited number of color preferences and individually finite positive weights that can produce invalid search vectors. Large lists increase synchronous computation without a capability-owned bound; extreme weights can overflow during accumulation or exceed the storage representation's numeric range.

This is an inherited issue found while reviewing #215, tracked as a separate, non-blocking follow-up to the Effect migration. The numerical failure was reproduced at commit `7e313c5a509e9a1b9ee9e6e21202e3cb8f203282`. No service-wide availability impact has been demonstrated.

## Reproduction

Against a running gateway with working OpenSearch and indexed wallpapers, send this query to `/graphql` (the local ingress used was `http://localhost:8160/gateway/graphql`):

```graphql
query {
  searchWallpapers(
    first: 1
    sort: {
      color: {
        colors: [
          { color: "#FF0000", amount: 1e308 }
          { color: "#FF0000", amount: 1e308 }
        ]
      }
    }
  ) {
    pageInfo {
      hasNextPage
    }
  }
}
```

Observed: HTTP 200 with `data: null` and a GraphQL error whose message is `The catalogue is temporarily unavailable` and whose code is `SERVICE_UNAVAILABLE`. Changing both weights to `1` succeeds on the same service. These inputs express the same relative color preference.

Source inspection also establishes that the `exact` strategy adds both weights into the same bin, producing `Infinity`. Individual finiteness checks do not protect the accumulated vector. The missing list limit is established by inspection; no load test was performed.

## Relevant code

Permanent references at the reviewed commit:

- [Color validation and vector construction](https://github.com/rafaeltab/wallpaperdb/blob/7e313c5a509e9a1b9ee9e6e21202e3cb8f203282/apps/gateway/src/catalogue/colors.ts#L161-L191): minimum list length only, individual amount validation, and unchecked accumulation.
- [Catalogue search passes the constructed vector to its read port](https://github.com/rafaeltab/wallpaperdb/blob/7e313c5a509e9a1b9ee9e6e21202e3cb8f203282/apps/gateway/src/catalogue/index.ts#L216-L240).
- [The pre-migration implementation](https://github.com/rafaeltab/wallpaperdb/blob/4b6c19e925e6b8ffe4f339065f906d39c2ed7e57/apps/gateway/src/services/color-sort.service.ts) has the same unbounded list and summation behavior.
- [Domain policy requires caller-controlled resource quantities to be bounded by their owning capability](https://github.com/rafaeltab/wallpaperdb/blob/7e313c5a509e9a1b9ee9e6e21202e3cb8f203282/docs/coding-standards/application-and-domain.md#domain-policy).

## Acceptance criteria

- Define and document a supported maximum number of color preferences, enforced by Catalogue before vector construction or storage access. Accept the boundary and reject one above it.
- Use numerically safe relative-weight handling so accepted inputs produce finite, nonzero vectors that OpenSearch accepts for `linear`, `exponential`, and `exact` strategies. Preserve color ranking for proportionally scaled weights, including the reproduction above.
- Preserve validation of empty lists, invalid hex colors, nonpositive/nonfinite weights, and invalid spreads. Rejected input returns `InvalidSearch` at the capability boundary and `BAD_USER_INPUT` through GraphQL, without contacting storage.
- Add regressions through the public Catalogue port for the count boundary, repeated and single extremely large weights, tiny positive weights, and mixed magnitudes. Verify invalid input never reaches the read port.
- Add a representative real OpenSearch/GraphQL regression showing extreme proportional weights yield a successful search consistent with ordinary weights. Pure calculation checks alone do not establish storage numeric compatibility.

Keep the numerical and work-bound policies in the capability. HTTP body limits and GraphQL complexity estimates do not replace those guarantees for other callers.
