package workbench

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/sylvinus/agent-vm/internal/guestos"
)

// This credential is encrypted with the account key, with a separate domain.
// Saving it in the account record makes password changes and the guest retry
// record one atomic write. Website vault APIs never see this data.
type macAccountEnvelope struct{ Nonce, Data []byte }
type macGuestCredential struct{ Username, Password string }
type macAccountData struct {
	Password string
	Guests   map[string]macGuestCredential
}

const macAccountDomain = "Cage shared macOS account v1"

func validMacAccount(name, password string) error {
	if !guestos.ValidMacOSAccountName(name) {
		return errors.New("The macOS shared username must start with a lowercase English letter and use 1-31 lowercase letters, digits, or underscores. System reserved names cannot be used.")
	}
	if !guestos.ValidMacOSInstallPassword(password) {
		return errors.New("The macOS shared password must be 8-256 letters, digits, spaces, or symbols that can be typed on an English keyboard.")
	}
	return nil
}
func sealMacAccount(record *accountRecord, key []byte, login macAccountData) error {
	block, err := aes.NewCipher(key)
	if err != nil {
		return err
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return err
	}
	plain, err := json.Marshal(login)
	if err != nil {
		return err
	}
	defer clear(plain)
	sealed := &macAccountEnvelope{Nonce: make([]byte, aead.NonceSize())}
	if _, err = rand.Read(sealed.Nonce); err != nil {
		return err
	}
	sealed.Data = aead.Seal(nil, sealed.Nonce, plain, []byte(macAccountDomain))
	record.MacLogin = sealed
	return nil
}

// Caller holds a.mu.
func (a *localAccount) openMacAccount() (macAccountData, error) {
	var login macAccountData
	if len(a.key) != 32 || a.record == nil {
		return login, errors.New("Unlock Cage first.")
	}
	if a.record.MacLogin == nil {
		return login, errors.New("Confirm the Cage username and password before installing the macOS guest.")
	}
	block, _ := aes.NewCipher(a.key)
	aead, _ := cipher.NewGCM(block)
	sealed := a.record.MacLogin
	if len(sealed.Nonce) != aead.NonceSize() {
		return login, errors.New("The guest shared credentials are corrupted. Restore the account backup.")
	}
	plain, err := aead.Open(nil, sealed.Nonce, sealed.Data, []byte(macAccountDomain))
	if err != nil {
		return login, errors.New("The guest shared credentials cannot be decrypted. Restore the account backup.")
	}
	defer clear(plain)
	if json.Unmarshal(plain, &login) != nil || validMacAccount(a.record.Username, login.Password) != nil {
		return login, errors.New("The guest shared credentials are invalid. Restore the account backup.")
	}
	return login, nil
}

// Existing password accounts prove their password; older trusted local accounts
// set their first password without replacing the account key or personal data.
func (a *localAccount) prepareMacAccount(name, password string, guests map[string]macGuestCredential) error {
	name = strings.TrimSpace(name)
	if err := validMacAccount(name, password); err != nil {
		return err
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	if len(a.key) != 32 || a.record == nil {
		return errors.New("Unlock Cage first.")
	}
	if a.record.MacLogin != nil {
		return errors.New("The shared credentials are already set. Change the password in the account settings.")
	}
	if a.record.TrustedDevice == "" {
		if time.Now().Before(a.nextAttempt) {
			return errors.New("Try again later.")
		}
		key, err := openAccountKey(a.record, password)
		if err != nil {
			a.nextAttempt = time.Now().Add(time.Second)
			return err
		}
		clear(key)
		a.nextAttempt = time.Time{}
	}
	record := *a.record
	record.Username, record.TrustedDevice = name, ""
	if err := sealAccountKey(&record, password, a.key); err != nil {
		return err
	}
	if err := sealMacAccount(&record, a.key, macAccountData{Password: password, Guests: guests}); err != nil {
		return err
	}
	if err := writePrivate(a.path, &record); err != nil {
		return errors.New("The shared credentials could not be saved. The original account and files were kept.")
	}
	a.record, a.trustedSession = &record, false
	return nil
}

func (a *localAccount) macGuestCredentials(ctx context.Context, id uuid.UUID) (macGuestCredential, error) {
	if ctx.Err() != nil {
		return macGuestCredential{}, ctx.Err()
	}
	if id == uuid.Nil {
		return macGuestCredential{}, errors.New("The guest installation identity is missing.")
	}
	a.mu.Lock()
	if a.record != nil && a.record.MacLogin != nil {
		login, err := a.openMacAccount()
		a.mu.Unlock()
		if err != nil {
			return macGuestCredential{}, err
		}
		if guest, ok := login.Guests[id.String()]; ok {
			return guest, nil
		}
	} else {
		a.mu.Unlock()
	}
	// Old installations retain their existing account and password.
	legacy, err := a.legacyMacGuestPassword(ctx, id)
	if err != nil {
		return macGuestCredential{}, err
	}
	if legacy != "" {
		return macGuestCredential{Username: "cage", Password: legacy}, nil
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	if ctx.Err() != nil {
		return macGuestCredential{}, ctx.Err()
	}
	login, err := a.openMacAccount()
	if err != nil {
		return macGuestCredential{}, err
	}
	if guest, ok := login.Guests[id.String()]; ok {
		return guest, nil
	}
	guest := macGuestCredential{Username: a.record.Username, Password: login.Password}
	if login.Guests == nil {
		login.Guests = map[string]macGuestCredential{}
	}
	login.Guests[id.String()] = guest
	record := *a.record
	if err = sealMacAccount(&record, a.key, login); err != nil {
		return macGuestCredential{}, err
	}
	if err = writePrivate(a.path, &record); err != nil {
		return macGuestCredential{}, errors.New("The guest credentials could not be saved. Check disk space and directory permissions.")
	}
	a.record = &record
	return guest, nil
}
func (a *localAccount) savedMacGuestPassword(ctx context.Context, id uuid.UUID) (string, error) {
	a.mu.Lock()
	if len(a.key) != 32 || ctx.Err() != nil {
		a.mu.Unlock()
		return "", errors.New("Unlock Cage first.")
	}
	if a.record.MacLogin != nil {
		login, err := a.openMacAccount()
		a.mu.Unlock()
		if err != nil {
			return "", err
		}
		if guest, ok := login.Guests[id.String()]; ok {
			return guest.Password, nil
		}
	} else {
		a.mu.Unlock()
	}
	return a.legacyMacGuestPassword(ctx, id)
}
func (a *localAccount) legacyMacGuestPassword(ctx context.Context, id uuid.UUID) (string, error) {
	var password string
	err := a.withVault(ctx, false, func(db *vaultData) error { password = db.GuestPasswords[id.String()]; return nil })
	return password, err
}

// syncMacPassword retries with both the last confirmed and the target password.
// The guest operation must be idempotent after any individual system write.
func (a *localAccount) syncMacPassword(ctx context.Context, id uuid.UUID, user string, apply func(context.Context, string, string) error) error {
	a.macSync.Lock()
	defer a.macSync.Unlock()
	a.mu.Lock()
	if a.record == nil || a.record.MacLogin == nil || len(a.key) != 32 {
		a.mu.Unlock()
		return nil
	}
	login, err := a.openMacAccount()
	if err != nil {
		a.mu.Unlock()
		return err
	}
	guest, ok := login.Guests[id.String()]
	if !ok || guest.Password == login.Password {
		a.mu.Unlock()
		return nil
	}
	if guest.Username != user {
		a.mu.Unlock()
		return errors.New("The guest sync account does not match the installation record. The original account was kept.")
	}
	target := login.Password
	a.mu.Unlock()
	if err = apply(ctx, guest.Password, target); err != nil {
		return errors.New("The Cage password was saved, but the guest password is still waiting to sync. Start the guest and try again. Until then the guest may still need the old password.")
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	login, err = a.openMacAccount()
	if err != nil {
		return err
	}
	current, ok := login.Guests[id.String()]
	if !ok || current != guest || login.Password != target {
		return errors.New("The guest password sync record has changed. Try again.")
	}
	current.Password = target
	login.Guests[id.String()] = current
	record := *a.record
	if err = sealMacAccount(&record, a.key, login); err != nil {
		return err
	}
	if err = writePrivate(a.path, &record); err != nil {
		return errors.New("The guest password was updated, but the confirmation record is waiting to be saved. The next start will retry the confirmation.")
	}
	a.record = &record
	return nil
}
