//go:build !windows

package guestos

import (
	"context"
	"errors"

	"github.com/google/uuid"
)

func InspectHyperV(context.Context, uuid.UUID) (HyperVInspection, error) {
	return HyperVInspection{}, errors.New("--vm-id only supports looking up local Windows Hyper-V virtual machines.")
}
