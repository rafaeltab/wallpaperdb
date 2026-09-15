// Repository policy. Keep generated-code and source exclusions here, independent
// of the analyzer's defaults. No permanent threshold is chosen during calibration.
export default {
  workspaceRoots: ['apps', 'packages'],
  excludedWorkspaces: ['apps/docs', 'apps/ingestor-e2e', 'apps/web-e2e'],
  sourceDirectory: 'src',
  coverageTasks: {
    'test:unit': 'coverage/unit',
    'test:integration': 'coverage/integration',
  },
  sourceExclusions: {
    useDefaultExclusions: false,
    excludePathRegexes: [
      '(^|/)(__tests__|tests?|specs?|setup|__setup__|__fixtures__|fixtures?|__mocks__|mocks?|stories|__stories__|node_modules|dist|build|out|coverage|\\.next|\\.turbo)(/|$)',
      '(^|/)([^/]*generated[^/]*|gen)(/|$)',
      '\\.(test|spec|fixture|mock|stories|story|setup|generated|gen|d)\\.[cm]?[jt]sx?$',
      '(^|/)(setup|setupTests|vitest\\.setup|jest\\.setup)\\.[cm]?[jt]sx?$',
      '(Generated|_grpc_pb|_pb|\\.pb|\\.ngfactory|\\.ngsummary|\\.ngtypecheck)\\.tsx?$',
    ],
    excludeGeneratedMarkers: [
      '@generated',
      '@auto-generated',
      'AUTO-GENERATED',
      'This file was generated',
      'This file is generated',
      'Do not edit',
      'DO NOT EDIT',
    ],
  },
};
