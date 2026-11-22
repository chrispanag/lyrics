package store_test

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/christos/lyrics/backend/internal/store"
	"github.com/christos/lyrics/backend/internal/testutil"
)

// The weights song_popularity_score applies. Pinned here so a change to the
// function fails this file instead of quietly reordering the catalog.
const (
	clickWeight    = 1
	listAddWeight  = 3
	listUserWeight = 10
)

func popularityScore(anon, users, adds, people int) int {
	return clickWeight*anon + clickWeight*users + listAddWeight*adds + listUserWeight*people
}

func TestClicksSplitAnonymousFromSignedInAndCollapseARepeat(t *testing.T) {
	st := testutil.NewStore(t)
	ctx := context.Background()
	song := mustSong(t, st, "Opened")
	visitor := uuid.New()
	user := seedUser(t, st, "listener@example.com", store.RoleUser)

	counted, err := st.RecordSongClick(ctx, song.ID, store.AnonymousClickActor(visitor), false)
	if err != nil || !counted {
		t.Fatalf("first anonymous click = (%v, %v), want counted", counted, err)
	}
	again, err := st.RecordSongClick(ctx, song.ID, store.AnonymousClickActor(visitor), false)
	if err != nil {
		t.Fatalf("repeat click: %v", err)
	}
	if again {
		t.Fatal("a second open inside the visit window counted as another click")
	}

	// A different browser is a different anonymous actor.
	if _, err := st.RecordSongClick(ctx, song.ID, store.AnonymousClickActor(uuid.New()), false); err != nil {
		t.Fatalf("second visitor: %v", err)
	}
	// Signing in is a different actor from the same person's anonymous opens.
	if _, err := st.RecordSongClick(ctx, song.ID, store.UserClickActor(user.ID), true); err != nil {
		t.Fatalf("signed-in click: %v", err)
	}
	if _, err := st.RecordSongClick(ctx, song.ID, store.UserClickActor(user.ID), true); err != nil {
		t.Fatalf("repeat signed-in click: %v", err)
	}

	got := popularity(t, st, song.ID)
	if got.AnonymousClicks != 2 || got.AuthenticatedClicks != 1 {
		t.Fatalf("clicks = %d anonymous, %d signed in, want 2 and 1",
			got.AnonymousClicks, got.AuthenticatedClicks)
	}
	if got.Score != popularityScore(2, 1, 0, 0) {
		t.Fatalf("score = %d, want %d", got.Score, popularityScore(2, 1, 0, 0))
	}

	// Once the visit window has passed, the same actor counts again.
	rewindClick(t, st, song.ID, store.AnonymousClickActor(visitor))
	counted, err = st.RecordSongClick(ctx, song.ID, store.AnonymousClickActor(visitor), false)
	if err != nil || !counted {
		t.Fatalf("click after the window = (%v, %v), want counted", counted, err)
	}
	got = popularity(t, st, song.ID)
	if got.AnonymousClicks != 3 {
		t.Fatalf("anonymous clicks after the window = %d, want 3", got.AnonymousClicks)
	}
}

func TestClickOnAMissingSongIsNotFound(t *testing.T) {
	st := testutil.NewStore(t)

	_, err := st.RecordSongClick(context.Background(), uuid.New(), store.AnonymousClickActor(uuid.New()), false)
	if !store.IsNotFound(err) {
		t.Fatalf("RecordSongClick = %v, want ErrNotFound", err)
	}
}

func TestListPlacementsCountTimesAndPeople(t *testing.T) {
	st := testutil.NewStore(t)
	ctx := context.Background()
	song := mustSong(t, st, "Saved")
	ada := seedUser(t, st, "ada@example.com", store.RoleUser)
	bea := seedUser(t, st, "bea@example.com", store.RoleUser)

	// Not "Favorites": provisioning already created that default list.
	favorites := mustList(t, st, ada.ID, "Kept")
	more := mustList(t, st, ada.ID, "More")
	beas := mustList(t, st, bea.ID, "Bea's")

	// Two lists, one person: one person, two placements.
	mustAdd(t, st, favorites.ID, song.ID)
	mustAdd(t, st, favorites.ID, song.ID) // the idempotent re-add
	mustAdd(t, st, more.ID, song.ID)

	got := popularity(t, st, song.ID)
	if got.ListAdds != 2 || got.ListUsers != 1 {
		t.Fatalf("after ada's two lists: adds=%d users=%d, want 2 and 1", got.ListAdds, got.ListUsers)
	}

	mustAdd(t, st, beas.ID, song.ID)
	got = popularity(t, st, song.ID)
	if got.ListAdds != 3 || got.ListUsers != 2 {
		t.Fatalf("after bea: adds=%d users=%d, want 3 and 2", got.ListAdds, got.ListUsers)
	}

	// Dropping one of ada's lists leaves her as a saver. The placement stays
	// counted: it did happen.
	if err := st.RemoveSongFromList(ctx, more.ID, song.ID); err != nil {
		t.Fatalf("RemoveSongFromList: %v", err)
	}
	got = popularity(t, st, song.ID)
	if got.ListAdds != 3 || got.ListUsers != 2 {
		t.Fatalf("after removing one of ada's: adds=%d users=%d, want 3 and 2", got.ListAdds, got.ListUsers)
	}

	// Dropping the last of ada's lists drops her, not the historical placement.
	if err := st.RemoveSongFromList(ctx, favorites.ID, song.ID); err != nil {
		t.Fatalf("RemoveSongFromList: %v", err)
	}
	got = popularity(t, st, song.ID)
	if got.ListAdds != 3 || got.ListUsers != 1 {
		t.Fatalf("after ada removed it entirely: adds=%d users=%d, want 3 and 1", got.ListAdds, got.ListUsers)
	}
	if got.Score != popularityScore(0, 0, 3, 1) {
		t.Fatalf("score = %d, want %d", got.Score, popularityScore(0, 0, 3, 1))
	}

	// Putting it back counts as another placement, and ada is a saver again.
	mustAdd(t, st, favorites.ID, song.ID)
	got = popularity(t, st, song.ID)
	if got.ListAdds != 4 || got.ListUsers != 2 {
		t.Fatalf("after ada saves it again: adds=%d users=%d, want 4 and 2", got.ListAdds, got.ListUsers)
	}
}

func TestConcurrentPlacementsAreAllCounted(t *testing.T) {
	st := testutil.NewStore(t)
	song := mustSong(t, st, "Crowded")

	const savers = 8
	lists := make([]uuid.UUID, savers)
	for i := range lists {
		user := seedUser(t, st, uuid.NewString()+"@example.com", store.RoleUser)
		lists[i] = mustList(t, st, user.ID, "Mine").ID
	}

	// Side by side, so each placement's trigger runs while another's is open.
	errs := make(chan error, savers)
	for _, listID := range lists {
		go func() { errs <- st.AddSongToList(context.Background(), listID, song.ID) }()
	}
	for range savers {
		if err := <-errs; err != nil {
			t.Fatalf("AddSongToList: %v", err)
		}
	}

	got := popularity(t, st, song.ID)
	if got.ListAdds != savers || got.ListUsers != savers {
		t.Fatalf("adds=%d users=%d, want %d and %d", got.ListAdds, got.ListUsers, savers, savers)
	}
	if got.Score != popularityScore(0, 0, savers, savers) {
		t.Fatalf("score = %d, want %d", got.Score, popularityScore(0, 0, savers, savers))
	}
}

func TestCopyingAListCountsForTheNewOwner(t *testing.T) {
	st := testutil.NewStore(t)
	ctx := context.Background()
	song := mustSong(t, st, "Shared")
	owner := seedUser(t, st, "owner@example.com", store.RoleUser)
	copier := seedUser(t, st, "copier@example.com", store.RoleUser)

	source := mustList(t, st, owner.ID, "Source")
	mustAdd(t, st, source.ID, song.ID)

	if _, err := st.CopyList(ctx, source.ID, copier.ID, "Copy"); err != nil {
		t.Fatalf("CopyList: %v", err)
	}

	got := popularity(t, st, song.ID)
	if got.ListAdds != 2 || got.ListUsers != 2 {
		t.Fatalf("after a copy: adds=%d users=%d, want 2 and 2", got.ListAdds, got.ListUsers)
	}
}

func TestDeletingAUserDropsThemFromWhoHasItSaved(t *testing.T) {
	st := testutil.NewStore(t)
	song := mustSong(t, st, "Orphaned")
	ada := seedUser(t, st, "ada-gone@example.com", store.RoleUser)
	bea := seedUser(t, st, "bea-stays@example.com", store.RoleUser)
	mustAdd(t, st, mustList(t, st, ada.ID, "Ada").ID, song.ID)
	mustAdd(t, st, mustList(t, st, bea.ID, "Bea").ID, song.ID)

	if err := st.DeleteUser(context.Background(), ada.ID); err != nil {
		t.Fatalf("DeleteUser: %v", err)
	}

	got := popularity(t, st, song.ID)
	if got.ListAdds != 2 || got.ListUsers != 1 {
		t.Fatalf("after ada's account is deleted: adds=%d users=%d, want 2 and 1", got.ListAdds, got.ListUsers)
	}
}

func TestDeletingASongDoesNotFailOnItsTally(t *testing.T) {
	st := testutil.NewStore(t)
	ctx := context.Background()
	song := mustSong(t, st, "Leaving")
	owner := seedUser(t, st, "owner-del@example.com", store.RoleUser)
	mustAdd(t, st, mustList(t, st, owner.ID, "Held").ID, song.ID)
	if _, err := st.RecordSongClick(ctx, song.ID, store.AnonymousClickActor(uuid.New()), false); err != nil {
		t.Fatalf("RecordSongClick: %v", err)
	}

	if err := st.DeleteSong(ctx, song.ID); err != nil {
		t.Fatalf("DeleteSong: %v", err)
	}
	if _, err := st.GetSong(ctx, song.ID); !store.IsNotFound(err) {
		t.Fatalf("GetSong after delete: %v, want ErrNotFound", err)
	}
}

func TestPopularitySortsByScoreThenTitle(t *testing.T) {
	st := testutil.NewStore(t)
	ctx := context.Background()

	// Inserted so that newest-first would be the reverse of the popularity
	// order, which is what makes the sort observable.
	loved := mustSong(t, st, "Loved")
	opened := mustSong(t, st, "Opened Often")
	mustSong(t, st, "Quiet")
	// Two more with nothing recorded, so the zero-score tie-break (title) is
	// visible rather than a single leftover row.
	mustSong(t, st, "Aaa")
	mustSong(t, st, "Zzz")

	// Loved is saved by two people. Opened Often is only clicked.
	for _, owner := range []string{"one@example.com", "two@example.com"} {
		user := seedUser(t, st, owner, store.RoleUser)
		mustAdd(t, st, mustList(t, st, user.ID, "Mine").ID, loved.ID)
	}
	for range 5 {
		if _, err := st.RecordSongClick(ctx, opened.ID, store.AnonymousClickActor(uuid.New()), false); err != nil {
			t.Fatalf("RecordSongClick: %v", err)
		}
	}

	page, total, err := st.ListSongs(ctx, store.SongFilter{Sort: store.SortPopularity, Limit: 10})
	if err != nil {
		t.Fatalf("ListSongs: %v", err)
	}
	if total != 5 {
		t.Fatalf("total = %d, want 5", total)
	}
	// Loved scores 2*3 + 2*10 = 26. Opened Often scores 5. The rest score 0
	// and sort by title: Aaa, Quiet, Zzz.
	if got, want := titles(page), []string{"Loved", "Opened Often", "Aaa", "Quiet", "Zzz"}; !equal(got, want) {
		t.Fatalf("popularity order = %v, want %v", got, want)
	}
}

func TestSearchPopularityOrderKeepsTheSnippet(t *testing.T) {
	st := testutil.NewStore(t)
	ctx := context.Background()

	// Both match "θαλασσα". The title match is the relevant one; the other is
	// only a lyrics hit, and it is the one people saved.
	plain := mustSongWithLyrics(t, st, "Άλλο", "θάλασσα")
	titleMatch := mustSongWithLyrics(t, st, "Θάλασσα", "στίχοι")
	saver := seedUser(t, st, "saver@example.com", store.RoleUser)
	mustAdd(t, st, mustList(t, st, saver.ID, "One").ID, titleMatch.ID)
	for range 4 {
		user := seedUser(t, st, uuid.NewString()+"@example.com", store.RoleUser)
		mustAdd(t, st, mustList(t, st, user.ID, "Saved").ID, plain.ID)
	}

	relevance, _, err := st.ListSongs(ctx, store.SongFilter{Query: "θαλασσα", Limit: 10})
	if err != nil {
		t.Fatalf("ListSongs: %v", err)
	}
	if len(relevance) < 2 || relevance[0].ID != titleMatch.ID {
		t.Fatalf("relevance order = %v, want the title match first", titles(relevance))
	}

	ranked, _, err := st.ListSongs(ctx, store.SongFilter{
		Query: "θαλασσα", Sort: store.SortPopularity, Limit: 10,
	})
	if err != nil {
		t.Fatalf("ListSongs: %v", err)
	}
	if len(ranked) != 2 || ranked[0].ID != plain.ID {
		t.Fatalf("popularity order = %v, want the saved song first", titles(ranked))
	}
	if ranked[0].Snippet == nil {
		t.Error("search result lost its snippet when ordered by popularity")
	}
}

func mustSong(t *testing.T, st *store.Store, title string) *store.Song {
	t.Helper()
	return mustSongWithLyrics(t, st, title, "words")
}

func mustSongWithLyrics(t *testing.T, st *store.Store, title, lyrics string) *store.Song {
	t.Helper()
	song, err := st.CreateSong(context.Background(), store.SongInput{
		Title: title, Lyrics: lyrics, Language: "el",
	}, uuid.Nil)
	if err != nil {
		t.Fatalf("CreateSong(%q): %v", title, err)
	}
	return song
}

func mustList(t *testing.T, st *store.Store, owner uuid.UUID, name string) *store.List {
	t.Helper()
	list, err := st.CreateList(context.Background(), owner, name, nil, false)
	if err != nil {
		t.Fatalf("CreateList(%q): %v", name, err)
	}
	return list
}

func mustAdd(t *testing.T, st *store.Store, listID, songID uuid.UUID) {
	t.Helper()
	if err := st.AddSongToList(context.Background(), listID, songID); err != nil {
		t.Fatalf("AddSongToList: %v", err)
	}
}

func popularity(t *testing.T, st *store.Store, songID uuid.UUID) store.SongPopularity {
	t.Helper()
	song, err := st.GetSong(context.Background(), songID)
	if err != nil {
		t.Fatalf("GetSong: %v", err)
	}
	return song.Popularity
}

// rewindClick moves an actor's last counted open outside the visit window.
func rewindClick(t *testing.T, st *store.Store, songID uuid.UUID, actor string) {
	t.Helper()
	tag, err := st.Pool().Exec(context.Background(),
		`UPDATE song_clicks SET last_counted_at = $3 WHERE song_id = $1 AND actor_key = $2`,
		songID, actor, time.Now().Add(-31*time.Minute))
	if err != nil {
		t.Fatalf("rewind click: %v", err)
	}
	if tag.RowsAffected() != 1 {
		t.Fatalf("rewind updated %d rows, want 1", tag.RowsAffected())
	}
}
