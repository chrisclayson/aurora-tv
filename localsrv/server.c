#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <sys/socket.h>
#include <netinet/in.h>
#include <arpa/inet.h>

#define PORT 8099
#define REQ_MAX (1024 * 1024)
#define CFG_MAX (512 * 1024)

static char config_json[CFG_MAX];
static int config_len = 0;
static char auth_token[160];
static char local_ip[64];
static int config_rev = 0;
static int stop_requested = 0;
static char request[REQ_MAX];

static int find_header(const char *req, const char *name, char *out, int max);

/* Accepts a candidate IPv4 address found by the UDP probe, the peer socket or
   the browser's Host header. Loopback, wildcard and link-local addresses are
   never the address a phone should use to reach this TV. */
static int usable_lan_ip(const char *ip, int allow_public) {
  if (!ip || !ip[0]) return 0;
  struct in_addr addr;
  if (inet_pton(AF_INET, ip, &addr) != 1) return 0;
  unsigned int v = ntohl(addr.s_addr);
  unsigned int a = (v >> 24) & 0xff;
  unsigned int b = (v >> 16) & 0xff;
  if (a == 0 || a == 127) return 0;
  if (a == 169 && b == 254) return 0;
  if (allow_public) return 1;
  return a == 10 || (a == 192 && b == 168) || (a == 172 && b >= 16 && b <= 31);
}

static void remember_ip(const char *ip) {
  if (!usable_lan_ip(ip, 1)) return;
  snprintf(local_ip, sizeof(local_ip), "%s", ip);
}

/* UDP connect() does not send a packet; it makes the OS choose the outgoing
   interface, then getsockname() reveals that interface's address. This works
   even without internet access as long as the TV has a default route. */
static void discover_local_ip(void) {
  static const char *targets[] = { "8.8.8.8", "1.1.1.1" };
  for (int t = 0; t < 2; t++) {
    int fd = socket(AF_INET, SOCK_DGRAM, 0);
    if (fd < 0) continue;
    struct sockaddr_in dest;
    memset(&dest, 0, sizeof(dest));
    dest.sin_family = AF_INET;
    dest.sin_port = htons(53);
    inet_pton(AF_INET, targets[t], &dest.sin_addr);
    if (connect(fd, (struct sockaddr *)&dest, sizeof(dest)) == 0) {
      struct sockaddr_in name;
      socklen_t len = sizeof(name);
      memset(&name, 0, sizeof(name));
      if (getsockname(fd, (struct sockaddr *)&name, &len) == 0) {
        char found[64];
        found[0] = 0;
        inet_ntop(AF_INET, &name.sin_addr, found, sizeof(found));
        remember_ip(found);
        if (usable_lan_ip(local_ip, 0)) { close(fd); return; }
      }
    }
    close(fd);
  }
}

/* The accepted socket knows which local interface served the request. A
   request from a phone on the LAN therefore reveals the address the phone can
   use, even when systeminfo and the UDP probe are unavailable. */
static void capture_request_ip(int client, const char *req) {
  struct sockaddr_in name;
  socklen_t len = sizeof(name);
  memset(&name, 0, sizeof(name));
  if (getsockname(client, (struct sockaddr *)&name, &len) == 0) {
    char found[64];
    found[0] = 0;
    inet_ntop(AF_INET, &name.sin_addr, found, sizeof(found));
    if (usable_lan_ip(found, 0)) remember_ip(found);
  }

  if (usable_lan_ip(local_ip, 0)) return;

  char host[160];
  if (find_header(req, "host", host, sizeof(host))) {
    char *colon = strchr(host, ':');
    if (colon) *colon = 0;
    if (usable_lan_ip(host, 1)) remember_ip(host);
  }
}

static void send_all(int fd, const char *data, int len) {
  int sent = 0;
  while (sent < len) {
    int n = send(fd, data + sent, len - sent, 0);
    if (n <= 0) return;
    sent += n;
  }
}

static void respond(int fd, int code, const char *type, const char *body, int len, int extra_cors) {
  char header[1024];
  int n = snprintf(header, sizeof(header),
    "HTTP/1.0 %d %s\r\nContent-Type: %s\r\nContent-Length: %d\r\n"
    "Cache-Control: no-store\r\nConnection: close\r\n"
    "Access-Control-Allow-Origin: *\r\n"
    "Access-Control-Allow-Headers: Authorization, Content-Type, X-Aurora-Token, X-Aurora-New-Token\r\n"
    "Access-Control-Allow-Methods: GET, PUT, POST, OPTIONS\r\n"
    "%s"
    "\r\n",
    code, code == 200 ? "OK" : (code == 404 ? "Not Found" : "Bad Request"),
    type, len, extra_cors ? "Access-Control-Allow-Origin: *\r\n" : "");
  send_all(fd, header, n);
  if (len > 0) send_all(fd, body, len);
}

static void respond_cstr(int fd, int code, const char *type, const char *body) {
  respond(fd, code, type, body, (int)strlen(body), 0);
}

static int starts_with(const char *s, const char *prefix) {
  return strncmp(s, prefix, strlen(prefix)) == 0;
}

static int lower_eq(const char *a, const char *b, int n) {
  for (int i = 0; i < n; i++) {
    char x = a[i], y = b[i];
    if (x >= 'A' && x <= 'Z') x = (char)(x - 'A' + 'a');
    if (y >= 'A' && y <= 'Z') y = (char)(y - 'A' + 'a');
    if (x != y) return 0;
  }
  return 1;
}

static int find_header(const char *req, const char *name, char *out, int max) {
  out[0] = 0;
  const char *line = req;
  int name_len = (int)strlen(name);
  while (line && *line) {
    const char *next = strstr(line, "\r\n");
    const char *end = next ? next : line + strlen(line);
    if (lower_eq(line, name, name_len) && end - line > name_len && line[name_len] == ':') {
      const char *v = line + name_len + 1;
      while (v < end && (*v == ' ' || *v == '\t')) v++;
      int len = (int)(end - v);
      if (len >= max) len = max - 1;
      memcpy(out, v, len);
      out[len] = 0;
      return 1;
    }
    line = next ? next + 2 : NULL;
  }
  return 0;
}

static int authorized(const char *req) {
  char token[160];
  char bearer[180];
  if (find_header(req, "x-aurora-token", token, sizeof(token))) {
    if (!auth_token[0]) {
      snprintf(auth_token, sizeof(auth_token), "%s", token);
      return 1;
    }
    return !strcmp(token, auth_token);
  }
  if (find_header(req, "authorization", bearer, sizeof(bearer))) {
    const char *value = bearer;
    if (starts_with(value, "Bearer ")) value += 7;
    if (!auth_token[0]) {
      snprintf(auth_token, sizeof(auth_token), "%s", value);
      return 1;
    }
    return !strcmp(value, auth_token);
  }
  return auth_token[0] == 0;
}

static int valid_token(const char *value) {
  if (!value) return 0;
  int len = (int)strlen(value);
  if (len < 1 || len > 64) return 0;
  for (int i = 0; i < len; i++) {
    char c = value[i];
    if (!((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') ||
          (c >= '0' && c <= '9') || c == '-' || c == '_')) return 0;
  }
  return 1;
}

static void url_path(const char *request_line, char *out, int max) {
  const char *start = strchr(request_line, ' ');
  if (!start) { out[0] = 0; return; }
  start++;
  const char *end = strchr(start, ' ');
  if (!end) { out[0] = 0; return; }
  int len = (int)(end - start);
  if (len >= max) len = max - 1;
  memcpy(out, start, len);
  out[len] = 0;
  char *q = strchr(out, '?');
  if (q) *q = 0;
}

static const char *content_type_for(const char *path) {
  const char *dot = strrchr(path, '.');
  if (!dot) return "application/octet-stream";
  if (!strcmp(dot, ".html")) return "text/html; charset=utf-8";
  if (!strcmp(dot, ".css")) return "text/css; charset=utf-8";
  if (!strcmp(dot, ".js")) return "application/javascript; charset=utf-8";
  if (!strcmp(dot, ".json")) return "application/json; charset=utf-8";
  if (!strcmp(dot, ".wasm")) return "application/wasm";
  if (!strcmp(dot, ".png")) return "image/png";
  if (!strcmp(dot, ".svg")) return "image/svg+xml";
  return "application/octet-stream";
}

static void json_escape_copy(const char *src, int len, char *out, int max) {
  int j = 0;
  for (int i = 0; i < len && j < max - 2; i++) {
    char c = src[i];
    if (c == '"' || c == '\\') {
      out[j++] = '\\';
      out[j++] = c;
    } else if (c == '\n') {
      out[j++] = '\\';
      out[j++] = 'n';
    } else if (c == '\r') {
      continue;
    } else {
      out[j++] = c;
    }
  }
  out[j] = 0;
}

static void json_field(const char *key, char *out, int max) {
  out[0] = 0;
  if (config_len <= 0) return;
  char needle[64];
  snprintf(needle, sizeof(needle), "\"%s\"", key);
  const char *p = strstr(config_json, needle);
  if (!p) return;
  p = strchr(p + strlen(needle), ':');
  if (!p) return;
  p++;
  while (*p == ' ' || *p == '\t') p++;
  if (*p != '"') return;
  p++;
  const char *end = p;
  while (*end && *end != '"') {
    if (*end == '\\' && end[1]) end++;
    end++;
  }
  json_escape_copy(p, (int)(end - p), out, max);
}

static void send_wrapper(int fd) {
  char device[128];
  char name[256];
  char model[256];
  char body[CFG_MAX + 1024];
  json_field("deviceId", device, sizeof(device));
  json_field("deviceName", name, sizeof(name));
  json_field("model", model, sizeof(model));
  if (!device[0]) snprintf(device, sizeof(device), "local");
  if (!name[0]) snprintf(name, sizeof(name), "This TV");
  int n = snprintf(body, sizeof(body),
    "{\"device\":\"%s\",\"name\":\"%s\",\"model\":\"%s\",\"revision\":\"%d\",\"updatedAt\":\"\",\"config\":%s}",
    device, name, model, config_rev, config_len ? config_json : "{}");
  respond(fd, 200, "application/json; charset=utf-8", body, n, 0);
}

static void send_devices(int fd) {
  char device[128];
  char name[256];
  char model[256];
  char body[1200];
  json_field("deviceId", device, sizeof(device));
  json_field("deviceName", name, sizeof(name));
  json_field("model", model, sizeof(model));
  if (!device[0]) snprintf(device, sizeof(device), "local");
  if (!name[0]) snprintf(name, sizeof(name), "This TV");
  int n = snprintf(body, sizeof(body),
    "{\"devices\":[{\"id\":\"local\",\"name\":\"%s\",\"model\":\"%s\",\"updatedAt\":\"\"}]}",
    name, model);
  (void)device;
  respond(fd, 200, "application/json; charset=utf-8", body, n, 0);
}

static int extract_config_body(const char *body, int len, const char **out, int *outlen) {
  while (len > 0 && (*body == ' ' || *body == '\r' || *body == '\n' || *body == '\t')) { body++; len--; }
  if (len <= 0 || body[0] != '{') return 0;
  const char *config_key = strstr(body, "\"config\"");
  if (config_key && config_key < body + 40) {
    const char *p = strchr(config_key, ':');
    if (!p) return 0;
    p++;
    while (p < body + len && (*p == ' ' || *p == '\t')) p++;
    if (p >= body + len || *p != '{') return 0;
    const char *start = p;
    int depth = 0;
    int in_string = 0;
    int escape = 0;
    for (; p < body + len; p++) {
      char c = *p;
      if (in_string) {
        if (escape) escape = 0;
        else if (c == '\\') escape = 1;
        else if (c == '"') in_string = 0;
      } else {
        if (c == '"') in_string = 1;
        else if (c == '{') depth++;
        else if (c == '}') {
          depth--;
          if (depth == 0) {
            *out = start;
            *outlen = (int)(p - start + 1);
            return 1;
          }
        }
      }
    }
    return 0;
  }
  *out = body;
  *outlen = len;
  return 1;
}

static int file_exists(const char *path) {
  FILE *f = fopen(path, "rb");
  if (!f) return 0;
  fclose(f);
  return 1;
}

static void serve_file(int fd, const char *path) {
  char full[512];
  if (!strcmp(path, "/")) snprintf(full, sizeof(full), "/ui/index.html");
  else if (starts_with(path, "/styles.css")) snprintf(full, sizeof(full), "/ui/styles.css");
  else if (starts_with(path, "/app.js")) snprintf(full, sizeof(full), "/ui/app.js");
  else if (starts_with(path, "/favicon")) {
    respond_cstr(fd, 204, "text/plain", "");
    return;
  } else {
    respond_cstr(fd, 404, "text/plain", "Not found");
    return;
  }
  FILE *f = fopen(full, "rb");
  if (!f) {
    respond_cstr(fd, 404, "text/plain", "Not found");
    return;
  }
  fseek(f, 0, SEEK_END);
  long size = ftell(f);
  fseek(f, 0, SEEK_SET);
  if (size < 0 || size > REQ_MAX) { fclose(f); respond_cstr(fd, 500, "text/plain", "File too large"); return; }
  char *data = (char *)malloc((size_t)size);
  if (!data) { fclose(f); respond_cstr(fd, 500, "text/plain", "Out of memory"); return; }
  fread(data, 1, (size_t)size, f);
  fclose(f);
  respond(fd, 200, content_type_for(full), data, (int)size, 0);
  free(data);
}

static int handle_client(int client) {
  int total = 0;
  int header_end = -1;
  int content_length = 0;
  for (;;) {
    if (total >= REQ_MAX - 1) break;
    int n = recv(client, request + total, REQ_MAX - 1 - total, 0);
    if (n <= 0) break;
    total += n;
    request[total] = 0;
    char *end = strstr(request, "\r\n\r\n");
    if (!end) continue;
    header_end = (int)(end - request) + 4;
    char *cl = strstr(request, "Content-Length:");
    if (!cl) cl = strstr(request, "content-length:");
    if (cl) content_length = atoi(cl + 15);
    if (total >= header_end + content_length) break;
  }
  if (total <= 0) return 0;
  request[total] = 0;

  char method[16] = {0};
  sscanf(request, "%15s", method);
  char path[1024];
  url_path(request, path, sizeof(path));

  capture_request_ip(client, request);

  if (!strcmp(method, "OPTIONS")) {
    respond_cstr(client, 204, "text/plain", "");
    return 0;
  }

  if (!strcmp(path, "/api/health")) {
    char health[256];
    int n = snprintf(health, sizeof(health),
      "{\"ok\":true,\"service\":\"aurora-tv-local\",\"ip\":\"%s\"}", local_ip);
    respond(client, 200, "application/json; charset=utf-8", health, n, 0);
    return 0;
  }

  if (starts_with(path, "/api/") && !authorized(request)) {
    respond_cstr(client, 401, "application/json; charset=utf-8", "{\"error\":\"Unauthorised\"}");
    return 0;
  }

  /* The TV rotates the local-server token when Settings opens (to a random
     six-character import code) and closes. This keeps the port up instead of
     restarting the WebAssembly worker, which would leak its listening socket. */
  if (!strcmp(path, "/api/auth/shutdown")) {
    if (strcmp(method, "POST") && strcmp(method, "PUT")) {
      respond_cstr(client, 400, "application/json", "{\"error\":\"Use POST\"}");
      return 0;
    }
    stop_requested = 1;
    respond_cstr(client, 200, "application/json; charset=utf-8", "{\"ok\":true}");
    return 0;
  }

  if (!strcmp(path, "/api/auth/local")) {
    if (strcmp(method, "POST") && strcmp(method, "PUT")) {
      respond_cstr(client, 400, "application/json", "{\"error\":\"Use POST\"}");
      return 0;
    }
    char next[160];
    if (!find_header(request, "x-aurora-new-token", next, sizeof(next)) || !valid_token(next)) {
      respond_cstr(client, 400, "application/json", "{\"error\":\"Invalid token\"}");
      return 0;
    }
    snprintf(auth_token, sizeof(auth_token), "%s", next);
    respond_cstr(client, 200, "application/json; charset=utf-8", "{\"ok\":true}");
    return 0;
  }

  if (!strcmp(path, "/api/devices")) {
    if (!strcmp(method, "GET")) send_devices(client);
    else respond_cstr(client, 400, "application/json", "{\"error\":\"The on-TV server supports one TV\"}");
    return 0;
  }

  if (starts_with(path, "/api/config/") && (!strcmp(method, "GET") || !strcmp(method, "PUT") || !strcmp(method, "POST"))) {
    if (!strcmp(method, "GET")) {
      send_wrapper(client);
      return 0;
    }
    if (header_end <= 0 || total <= header_end) {
      respond_cstr(client, 400, "application/json", "{\"error\":\"Empty config\"}");
      return 0;
    }
    const char *body = request + header_end;
    int body_len = total - header_end;
    const char *config = body;
    int config_len_out = body_len;
    if (!extract_config_body(body, body_len, &config, &config_len_out) || config_len_out <= 1) {
      respond_cstr(client, 400, "application/json", "{\"error\":\"Config must be a JSON object\"}");
      return 0;
    }
    if (config_len_out >= CFG_MAX) {
      respond_cstr(client, 400, "application/json", "{\"error\":\"Config too large\"}");
      return 0;
    }
    memcpy(config_json, config, (size_t)config_len_out);
    config_json[config_len_out] = 0;
    config_len = config_len_out;
    config_rev++;
    send_wrapper(client);
    return 0;
  }

  if (starts_with(path, "/api/bootstrap/")) {
    if (config_len > 0) respond(client, 200, "application/json; charset=utf-8", config_json, config_len, 0);
    else respond_cstr(client, 200, "application/json; charset=utf-8", "{}");
    return 0;
  }

  if (starts_with(path, "/api/test/")) {
    respond_cstr(client, 200, "application/json; charset=utf-8",
      "{\"ok\":false,\"error\":\"Tests run on the optional LAN server, not on the TV\"}");
    return 0;
  }

  if (!strcmp(method, "GET") || !strcmp(method, "HEAD")) {
    serve_file(client, path);
    return 0;
  }

  respond_cstr(client, 404, "text/plain", "Not found");
  return 0;
}

int main(void) {
  int server = socket(AF_INET, SOCK_STREAM, 0);
  if (server < 0) { puts("socket failed"); return 1; }
  int yes = 1;
  setsockopt(server, SOL_SOCKET, SO_REUSEADDR, &yes, sizeof(yes));
  struct sockaddr_in addr;
  memset(&addr, 0, sizeof(addr));
  addr.sin_family = AF_INET;
  addr.sin_addr.s_addr = htonl(INADDR_ANY);
  addr.sin_port = htons(PORT);
  if (bind(server, (struct sockaddr *)&addr, sizeof(addr)) < 0) { puts("bind failed"); return 2; }
  if (listen(server, 16) < 0) { puts("listen failed"); return 3; }
  discover_local_ip();
  puts("Aurora on-TV config server listening on 8099");
  for (;;) {
    struct sockaddr_in peer;
    socklen_t peerlen = sizeof(peer);
    int client = accept(server, (struct sockaddr *)&peer, &peerlen);
    if (client < 0) continue;
    handle_client(client);
    close(client);
    if (stop_requested) break;
  }
  close(server);
  return 0;
}
