# Execution references

Implementation is pinned to the locally running OpenSearch **2.11.0**, verified through its root API. Later-version features are not assumed.

- [2.11 exact k-NN scoring script](https://docs.opensearch.org/docs/2.11/search-plugins/knn/knn-score-script/): exact distance search scans the eligible vector set; it is a correctness reference and a candidate to measure, not inherently a scalable retrieval strategy.
- [OpenSearch efficient vector filtering](https://opensearch.org/blog/efficient-filters-in-knn/): Lucene supports filtering within the native k-NN query; outer filtering has different result guarantees.
- [Function score query](https://docs.opensearch.org/latest/query-dsl/compound/function-score/): native scalar decay functions and custom scripts. Actual 2.11 requests must validate every used feature.

Local feature formulas are hand-authored experimental definitions, not a claim of calibrated perceptual truth. Human-feedback agreement, representation loss, and approximate retrieval loss are evaluated separately.
