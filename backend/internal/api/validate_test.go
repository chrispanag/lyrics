package api

import "testing"

// parseYouTubeURL is the authority on what link the catalog will store, and it
// had no direct coverage: every case below was reachable only through a request,
// so the hosts and path shapes it accepts were asserted nowhere on this side at
// all. Two other parsers are written to agree with it — extractVideoId in the
// editor, and the importer's own copy in cmd/import-songs — which is the reason
// to pin the shapes rather than a sample of them. A host quietly dropped from
// the switch is a link the editor previews and the save then refuses.
const videoID = "dQw4w9WgXcQ"

func TestParseYouTubeURL(t *testing.T) {
	for _, tc := range []struct {
		name string
		raw  string
	}{
		{"a watch link", "https://www.youtube.com/watch?v=" + videoID},
		{"a watch link with no www", "https://youtube.com/watch?v=" + videoID},
		{"an uppercased host", "https://WWW.YOUTUBE.COM/watch?v=" + videoID},
		// The three hosts a switch written from memory drops. Each is on the
		// list, so each must stay on it.
		{"the mobile host", "https://m.youtube.com/watch?v=" + videoID},
		{"the music host", "https://music.youtube.com/watch?v=" + videoID},
		{"the privacy-enhanced host", "https://www.youtube-nocookie.com/embed/" + videoID},
		// Every path shape the switch names.
		{"an embed link", "https://www.youtube.com/embed/" + videoID},
		{"a /v/ link", "https://www.youtube.com/v/" + videoID},
		{"a shorts link", "https://www.youtube.com/shorts/" + videoID},
		{"a live link", "https://www.youtube.com/live/" + videoID},
		{"a short link", "https://youtu.be/" + videoID},
		{"a short link carrying tracking", "https://youtu.be/" + videoID + "?si=abc123"},
		{"a watch link carrying tracking", "https://www.youtube.com/watch?v=" + videoID + "&t=42"},
		// Shapes that arrive pasted rather than copied from a share dialog.
		{"a scheme-less short link", "youtu.be/" + videoID},
		{"a scheme-less watch link", "www.youtube.com/watch?v=" + videoID},
		{"a protocol-relative short link", "//youtu.be/" + videoID},
		{"a bare id", videoID},
		{"a bare id with surrounding space", "  " + videoID + "  "},
		{"http rather than https", "http://www.youtube.com/watch?v=" + videoID},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got, ok := parseYouTubeURL(tc.raw)
			if !ok {
				t.Fatalf("parseYouTubeURL(%q) refused a link the catalog should store", tc.raw)
			}
			if got != videoID {
				t.Errorf("id = %q, want %q", got, videoID)
			}
		})
	}
}

func TestParseYouTubeURLRefuses(t *testing.T) {
	for _, tc := range []struct {
		name string
		raw  string
		why  string
	}{
		{"an empty string", "", "there is no link"},
		{"whitespace only", "   ", "trimming leaves nothing"},
		{"another video site", "https://vimeo.com/123", "it is not YouTube"},
		{
			// The importer's copy accepts this one, because it tests the host
			// with strings.HasSuffix. This is the half that gets it right.
			"a host merely ending in the right one",
			"https://notyoutube.com/watch?v=" + videoID,
			"the host is compared whole, not by suffix",
		},
		{
			// What a pattern matched against raw text finds anywhere in the
			// string, and the reason this reads the host as a host.
			"a YouTube link inside another site's URL",
			"https://example.com/r?u=https://www.youtube.com/watch?v=" + videoID,
			"the host is example.com",
		},
		{
			// Load-bearing for the editor's mirror, which prefixes a scheme only
			// when the input contains no "//" at all. Tightened to "://" there,
			// this string would preview while still being refused here.
			"a doubled path separator",
			"youtube.com//watch?v=" + videoID,
			"it already contains // so no scheme is added, leaving no host",
		},
		{"a playlist", "https://www.youtube.com/playlist?list=PL" + videoID, "there is no v"},
		{"a channel page", "https://www.youtube.com/@someone", "one path segment, and not a video"},
		{"an unknown path shape", "https://www.youtube.com/feed/" + videoID, "feed is not a video path"},
		{"an embed link with a trailing segment", "https://www.youtube.com/embed/" + videoID + "/extra", "three segments, not two"},
		{"a short link with a trailing segment", "https://youtu.be/" + videoID + "/extra", "the path is not an id"},
		{"a short link with no id", "https://youtu.be/", "the path is empty"},
		{"an id that is too short", "https://www.youtube.com/watch?v=abc", "an id is exactly eleven characters"},
		{"an id that is too long", "https://youtu.be/" + videoID + "XYZ", "an id is exactly eleven characters"},
		{"an id holding an illegal character", "https://www.youtube.com/watch?v=abcdefghij!", "the alphabet is [A-Za-z0-9_-]"},
		{"an uppercased query key", "https://www.youtube.com/watch?V=" + videoID, "the v lookup is case-sensitive, like Query().Get"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got, ok := parseYouTubeURL(tc.raw); ok {
				t.Errorf("parseYouTubeURL(%q) returned %q, want refusal: %s", tc.raw, got, tc.why)
			}
		})
	}
}
