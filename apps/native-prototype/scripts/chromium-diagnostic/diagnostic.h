// Copied-build diagnostic only. No JSON allocation or file writes per frame.
#ifndef WDB_CHROMIUM_DIAGNOSTIC_H
#define WDB_CHROMIUM_DIAGNOSTIC_H
#define DIAG_CAPACITY 32768
enum {
  D_RECEIVE = 1,
  D_MAP = 2,
  D_UPLOAD_CPU = 3,
  D_IMPORT_CPU = 4,
  D_FENCE_OBSERVED = 5,
  D_ACK_SENT = 6,
  D_ACK_RETRY = 7
};
typedef struct {
  double at, duration;
  uint64_t id;
  int stage;
} DiagnosticRow;
static DiagnosticRow diagnostic_rows[DIAG_CAPACITY]; // 1 MiB on this ABI.
static size_t diagnostic_count, diagnostic_overflow;
static int diagnostic_active, diagnostic_started, diagnostic_flushed;
static double diagnostic_started_at, diagnostic_deadline,
    diagnostic_import_began, diagnostic_fence_began;
static double diagnostic_clock(void) {
  struct timespec t;
  clock_gettime(CLOCK_MONOTONIC, &t);
  return t.tv_sec + t.tv_nsec / 1e9;
}
static double diagnostic_begin(void) {
  return diagnostic_active ? diagnostic_clock() : 0;
}
static void diagnostic_span(int stage, uint64_t id, double began) {
  if (!diagnostic_active || !began)
    return;
  double ended = diagnostic_clock();
  if (ended > diagnostic_deadline) {
    diagnostic_active = 0;
    return;
  }
  if (diagnostic_count == DIAG_CAPACITY) {
    diagnostic_overflow++;
    return;
  }
  diagnostic_rows[diagnostic_count++] =
      (DiagnosticRow){began, ended - began, id, stage};
}
static void diagnostic_finish(void) {
  diagnostic_active = 0;
  if (!diagnostic_started || diagnostic_flushed)
    return;
  diagnostic_flushed = 1;
  double ended = diagnostic_clock();
  if (ended > diagnostic_deadline)
    ended = diagnostic_deadline;
  const char *directory = getenv("WDB_CHROMIUM_DIAG_DIR");
  if (!directory)
    return;
  char file[1024];
  if (snprintf(file, sizeof file, "%s/presenter-stages.csv", directory) >=
      (int)sizeof file)
    return;
  FILE *out = fopen(file, "wx");
  if (!out)
    return;
  fprintf(out, "stage,id,at_monotonic_us,duration_us\n");
  for (size_t i = 0; i < diagnostic_count; i++) {
    DiagnosticRow *row = &diagnostic_rows[i];
    fprintf(out, "%d,%llu,%.3f,%.3f\n", row->stage, (unsigned long long)row->id,
            row->at * 1e6, row->duration * 1e6);
  }
  fclose(out);
  if (snprintf(file, sizeof file, "%s/presenter-diagnostic.json", directory) >=
      (int)sizeof file)
    return;
  out = fopen(file, "wx");
  if (!out)
    return;
  fprintf(out,
          "{\"diagnostic_only\":true,\"pid\":%d,\"buffer_bytes\":%zu,"
          "\"rows\":%zu,\"overflow\":%zu,\"clock\":\"CLOCK_MONOTONIC "
          "microseconds\","
          "\"start_monotonic_us\":%.3f,\"end_monotonic_us\":%.3f,"
          "\"codes\":{\"receive_header_cpu\":1,\"mmap_cpu\":2,\"texture_upload_"
          "cpu\":3,"
          "\"import_total_cpu\":4,\"fence_observed_delay\":5,\"ack_send_cpu\":"
          "6,\"ack_retry_cpu\":7},"
          "\"limits\":\"Upload is CPU call time. Fence delay includes GPU "
          "completion, client scheduling and polling. Neither is an isolated "
          "GPU execution measurement.\"}\n",
          getpid(), sizeof diagnostic_rows, diagnostic_count,
          diagnostic_overflow, diagnostic_started_at * 1e6, ended * 1e6);
  fclose(out);
}
static void diagnostic_control(int enabled) {
  if (!enabled) {
    diagnostic_finish();
    return;
  }
  if (diagnostic_started || !getenv("WDB_CHROMIUM_DIAG_DIR"))
    return;
  const char *text = getenv("WDB_CHROMIUM_DIAG_SECONDS");
  double seconds = text ? atof(text) : 12;
  if (!(seconds >= 1 && seconds <= 15))
    return;
  diagnostic_started = diagnostic_active = 1;
  diagnostic_started_at = diagnostic_clock();
  diagnostic_deadline = diagnostic_started_at + seconds;
}
#endif
