package api

import "testing"

// parseYouTubeURL is the authority that extractVideoId (web) and the importer's
// copy agree with, so every accepted shape is pinned, not a sample.
const videoID = "dQw4w9WgXcQ"

func TestParseYouTubeURL(t *testing.T) {
	for _, tc := range []struct {
		name string
		raw  string
	}{
		{"a watch link", "https://www.youtube.com/watch?v=" + videoID},
		{"a watch link with no www", "https://youtube.com/watch?v=" + videoID},
		{"an uppercased host", "https://WWW.YOUTUBE.COM/watch?v=" + videoID},
		// The hosts a switch written from memory drops.
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
			// The importer's copy accepts this (strings.HasSuffix); this one must not.
			"a host merely ending in the right one",
			"https://notyoutube.com/watch?v=" + videoID,
			"the host is compared whole, not by suffix",
		},
		{
			"a YouTube link inside another site's URL",
			"https://example.com/r?u=https://www.youtube.com/watch?v=" + videoID,
			"the host is example.com",
		},
		{
			// Pins the editor mirror's "//" check; tightening it to "://" there
			// would preview this while the save refuses it.
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
