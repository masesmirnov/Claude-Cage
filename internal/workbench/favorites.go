package workbench

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"slices"
	"strings"
)

type Favorite struct {
	ID       string `json:"id"`
	Title    string `json:"title"`
	URL      string `json:"url"`
	FolderID string `json:"folder_id"`
}
type FavoriteFolder struct {
	ID    string `json:"id"`
	Title string `json:"title"`
}
type Favorites struct {
	Items   []Favorite       `json:"items"`
	Folders []FavoriteFolder `json:"folders"`
}

func (s *Server) readFavorites() (Favorites, error) {
	f := Favorites{Items: []Favorite{}, Folders: []FavoriteFolder{}}
	b, err := os.ReadFile(filepath.Join(s.profile, "favorites.json"))
	if os.IsNotExist(err) {
		return f, nil
	}
	if err != nil {
		return f, errors.New("Favorites could not be read. Check the configuration directory permissions.")
	}
	if json.Unmarshal(b, &f) != nil {
		return f, errors.New("The favorites file could not be read. Keep the file, fix it, and try again.")
	}
	if f.Items == nil {
		f.Items = []Favorite{}
	}
	if f.Folders == nil {
		f.Folders = []FavoriteFolder{}
	}
	return f, nil
}

type favoriteChange struct {
	Action   string `json:"action"`
	ID       string `json:"id"`
	Title    string `json:"title"`
	URL      string `json:"url"`
	FolderID string `json:"folder_id"`
}

func (s *Server) serveFavorites(w http.ResponseWriter, r *http.Request) {
	var change *favoriteChange
	if r.Method == http.MethodPost {
		change = &favoriteChange{}
		if !readJSON(w, r, change) {
			return
		}
	}
	var f Favorites
	var err error
	if r.URL.Path == "/api/mobile/browser/favorites" {
		s.account.mu.Lock()
		s.phones.mu.Lock()
		if !s.mobileAuthorized(r.Context()) || !s.phones.pairedRequestLocked(r) {
			s.phones.mu.Unlock()
			s.account.mu.Unlock()
			http.Error(w, "Connect with your computer's pairing code or QR code, then open Favorites.", http.StatusForbidden)
			return
		}
		f, err = s.changeFavorites(change)
		s.phones.mu.Unlock()
		s.account.mu.Unlock()
	} else {
		f, err = s.changeFavorites(change)
	}
	if err != nil {
		requestError(w, err)
		return
	}
	jsonReply(w, f)
}

// Read and modify the latest host collection under the same lock on both clients.
func (s *Server) changeFavorites(input *favoriteChange) (Favorites, error) {
	s.favoritesMu.Lock()
	defer s.favoritesMu.Unlock()
	f, err := s.readFavorites()
	if err != nil || input == nil {
		return f, err
	}
	input.Title = strings.TrimSpace(input.Title)
	input.URL = strings.TrimSpace(input.URL)
	itemIndex := slices.IndexFunc(f.Items, func(item Favorite) bool { return item.ID == input.ID })
	folderIndex := slices.IndexFunc(f.Folders, func(folder FavoriteFolder) bool { return folder.ID == input.ID })
	switch input.Action {
	case "save", "save_folder":
		if input.Title == "" || len(input.Title) > 1000 {
			return f, errors.New("Enter a name. If it is too long, shorten it and try again.")
		}
		if input.Action == "save_folder" {
			if input.ID == "" {
				f.Folders = append(f.Folders, FavoriteFolder{ID: randomToken()[:24], Title: input.Title})
			} else if folderIndex >= 0 {
				f.Folders[folderIndex].Title = input.Title
			} else {
				return f, errors.New("The favorites folder no longer exists. Reopen Favorites.")
			}
			break
		}
		u, parseErr := url.Parse(input.URL)
		if parseErr != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Hostname() == "" || u.User != nil || len(input.URL) > 16384 {
			return f, errors.New("A favorite's address must be an HTTP(S) URL without a username or password.")
		}
		if input.FolderID != "" && !slices.ContainsFunc(f.Folders, func(folder FavoriteFolder) bool { return folder.ID == input.FolderID }) {
			return f, errors.New("The selected favorites folder no longer exists. Select again.")
		}
		if input.ID == "" {
			// Repeated clicks on a page's star update its existing favorite.
			itemIndex = slices.IndexFunc(f.Items, func(item Favorite) bool { return item.URL == input.URL })
			if itemIndex >= 0 {
				input.ID = f.Items[itemIndex].ID
			} else {
				input.ID = randomToken()[:24]
			}
		} else if itemIndex < 0 {
			return f, errors.New("The favorite no longer exists. Reopen Favorites.")
		}
		item := Favorite{ID: input.ID, Title: input.Title, URL: input.URL, FolderID: input.FolderID}
		if itemIndex < 0 {
			f.Items = append(f.Items, item)
		} else {
			f.Items[itemIndex] = item
		}
	case "delete":
		if itemIndex >= 0 {
			f.Items = slices.Delete(f.Items, itemIndex, itemIndex+1)
		}
	case "delete_folder":
		if folderIndex >= 0 {
			f.Folders = slices.Delete(f.Folders, folderIndex, folderIndex+1)
			for i := range f.Items {
				if f.Items[i].FolderID == input.ID {
					f.Items[i].FolderID = ""
				}
			}
		}
	default:
		return f, errors.New("Unknown favorites operation.")
	}
	if err := writePrivate(filepath.Join(s.profile, "favorites.json"), f); err != nil {
		return f, errors.New("The favorite could not be saved. Check disk space and permissions, then try again.")
	}
	return f, nil
}
