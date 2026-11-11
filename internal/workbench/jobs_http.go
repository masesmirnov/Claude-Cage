package workbench

import (
	"errors"
	"net/http"
)

func (s *Server) launch(w http.ResponseWriter, kind string, run func() error) {
	job, err := s.submitJob(kind, run)
	switch {
	case errors.Is(err, errJobsClosed):
		http.Error(w, "The backend is updating. Reopen Cage.", http.StatusServiceUnavailable)
	case errors.Is(err, errJobBusy):
		http.Error(w, "Another operation is still running. Wait a moment.", http.StatusConflict)
	case err != nil:
		requestError(w, err)
	default:
		jsonReply(w, job)
	}
}
