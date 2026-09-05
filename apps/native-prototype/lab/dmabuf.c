// Node-API bridge: no Electron ABI dependency. SCM_RIGHTS duplicates plane FDs.
#include <errno.h>
#include <node_api.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/un.h>
#include <unistd.h>
static napi_value num(napi_env e, int n) {
  napi_value v;
  napi_create_int32(e, n, &v);
  return v;
}
static napi_value fail(napi_env e, const char *s) {
  napi_throw_error(e, NULL, s);
  return NULL;
}
static napi_value conn(napi_env e, napi_callback_info i) {
  napi_value a[1];
  size_t n = 1, l;
  napi_get_cb_info(e, i, &n, a, NULL, NULL);
  struct sockaddr_un s = {.sun_family = AF_UNIX};
  napi_get_value_string_utf8(e, a[0], s.sun_path, sizeof s.sun_path, &l);
  int fd = socket(AF_UNIX, SOCK_SEQPACKET | SOCK_CLOEXEC | SOCK_NONBLOCK, 0);
  if (fd < 0 || connect(fd, (void *)&s, sizeof s) < 0) {
    if (fd >= 0)
      close(fd);
    return fail(e, strerror(errno));
  }
  return num(e, fd);
}
static napi_value submit(napi_env e, napi_callback_info i) {
  napi_value a[3];
  size_t n = 3, l;
  napi_get_cb_info(e, i, &n, a, NULL, NULL);
  int fd;
  napi_get_value_int32(e, a[0], &fd);
  napi_get_value_string_utf8(e, a[1], NULL, 0, &l);
  if (l > 32768)
    return fail(e, "Frame header too large");
  char json[32769];
  napi_get_value_string_utf8(e, a[1], json, sizeof json, &l);
  uint32_t count;
  napi_get_array_length(e, a[2], &count);
  if (count < 1 || count > 4)
    return fail(e, "Expected 1-4 DMA-BUF planes");
  int fds[4];
  for (unsigned j = 0; j < count; j++) {
    napi_value v;
    napi_get_element(e, a[2], j, &v);
    napi_get_value_int32(e, v, &fds[j]);
  }
  char control[CMSG_SPACE(sizeof fds)] = {0};
  struct iovec io = {json, l};
  struct msghdr m = {.msg_iov = &io,
                     .msg_iovlen = 1,
                     .msg_control = control,
                     .msg_controllen = CMSG_SPACE(count * sizeof(int))};
  struct cmsghdr *c = CMSG_FIRSTHDR(&m);
  c->cmsg_level = SOL_SOCKET;
  c->cmsg_type = SCM_RIGHTS;
  c->cmsg_len = CMSG_LEN(count * sizeof(int));
  memcpy(CMSG_DATA(c), fds, count * sizeof(int));
  napi_value ok;
  napi_get_boolean(
      e, sendmsg(fd, &m, MSG_DONTWAIT | MSG_NOSIGNAL) == (ssize_t)l, &ok);
  return ok;
}
static napi_value poll_ack(napi_env e, napi_callback_info i) {
  napi_value a[1], r;
  size_t n = 1;
  napi_get_cb_info(e, i, &n, a, NULL, NULL);
  int fd;
  napi_get_value_int32(e, a[0], &fd);
  napi_create_array(e, &r);
  int j = 0;
  char b[128];
  ssize_t l;
  while ((l = recv(fd, b, sizeof(b) - 1, MSG_DONTWAIT)) > 0) {
    b[l] = 0;
    napi_set_element(e, r, j++, num(e, atoi(b)));
  }
  return r;
}
static napi_value cls(napi_env e, napi_callback_info i) {
  napi_value a[1];
  size_t n = 1;
  int fd;
  napi_get_cb_info(e, i, &n, a, NULL, NULL);
  napi_get_value_int32(e, a[0], &fd);
  close(fd);
  return num(e, 0);
}
static napi_value init(napi_env e, napi_value x) {
  napi_property_descriptor p[] = {
      {"connect", 0, conn, 0, 0, 0, napi_default, 0},
      {"submit", 0, submit, 0, 0, 0, napi_default, 0},
      {"poll", 0, poll_ack, 0, 0, 0, napi_default, 0},
      {"close", 0, cls, 0, 0, 0, napi_default, 0}};
  napi_define_properties(e, x, 4, p);
  return x;
}
NAPI_MODULE(NODE_GYP_MODULE_NAME, init)
