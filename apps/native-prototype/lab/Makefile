# Disposable native presentation experiments. The Rust daemon owns their lifetime.
BUILD := build
PROTOCOLS := /usr/share/wayland-protocols
PKGS := wayland-client wayland-egl egl epoxy mpv luajit json-c
CFLAGS := -O2 -g -std=gnu11 -Wall -Wextra -Wno-unused-parameter $(shell pkg-config --cflags $(PKGS)) -I$(BUILD)
LDLIBS := $(shell pkg-config --libs $(PKGS)) -lm
GENERATED := $(BUILD)/layer.c $(BUILD)/color.c $(BUILD)/presentation.c $(BUILD)/xdg.c
.PHONY: all clean test
all: $(BUILD)/presenter $(BUILD)/dmabuf.node
$(BUILD):
	@mkdir -p $@
$(BUILD)/layer.h $(BUILD)/layer.c &: protocols/wlr-layer-shell.xml | $(BUILD)
	wayland-scanner client-header $< $(BUILD)/layer.h
	wayland-scanner private-code $< $(BUILD)/layer.c
$(BUILD)/color.h $(BUILD)/color.c &: $(PROTOCOLS)/staging/color-management/color-management-v1.xml | $(BUILD)
	wayland-scanner client-header $< $(BUILD)/color.h
	wayland-scanner private-code $< $(BUILD)/color.c
$(BUILD)/presentation.h $(BUILD)/presentation.c &: $(PROTOCOLS)/stable/presentation-time/presentation-time.xml | $(BUILD)
	wayland-scanner client-header $< $(BUILD)/presentation.h
	wayland-scanner private-code $< $(BUILD)/presentation.c
$(BUILD)/xdg.c: $(PROTOCOLS)/stable/xdg-shell/xdg-shell.xml | $(BUILD)
	wayland-scanner private-code $< $@
$(BUILD)/presenter: presenter.c pacing.h media_texture.h $(GENERATED) $(BUILD)/layer.h $(BUILD)/color.h $(BUILD)/presentation.h
	$(CC) $(CFLAGS) presenter.c $(GENERATED) $(LDLIBS) -o $@
$(BUILD)/dmabuf.node: dmabuf.c | $(BUILD)
	$(CC) -shared -fPIC -O2 -Wall -Wextra -I/usr/include/node $< -o $@
$(BUILD)/pacing-test: pacing_test.c pacing.h | $(BUILD)
	$(CC) -std=c11 -O2 -Wall -Wextra -Werror $< -lm -o $@
$(BUILD)/media-texture-test: media_texture_test.c media_texture.h | $(BUILD)
	$(CC) -std=c11 -O2 -Wall -Wextra -Werror $< -o $@
test: $(BUILD)/pacing-test $(BUILD)/media-texture-test
	./$(BUILD)/pacing-test
	./$(BUILD)/media-texture-test
clean:
	rm -f $(BUILD)/presenter $(BUILD)/dmabuf.node $(GENERATED) $(BUILD)/*.h
