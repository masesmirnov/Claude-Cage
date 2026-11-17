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
type macGuestCredential struct{ Username, Password, PendingPassword string }
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
	return openMacAccountKey(a.record, a.key)
}

func openMacAccountKey(record *accountRecord, key []byte) (macAccountData, error) {
	var login macAccountData
	if len(key) != 32 || record == nil {
		return login, errors.New("Unlock Cage first.")
	}
	if record.MacLogin == nil {
		return login, errors.New("Confirm the Cage username and password before installing the macOS guest.")
	}
	block, _ := aes.NewCipher(key)
	aead, _ := cipher.NewGCM(block)
	sealed := record.MacLogin
	if len(sealed.Nonce) != aead.NonceSize() {
		return login, errors.New("The guest shared credentials are corrupted. Restore the account backup.")
	}
	plain, err := aead.Open(nil, sealed.Nonce, sealed.Data, []byte(macAccountDomain))
	if err != nil {
		return login, errors.New("The guest shared credentials cannot be decrypted. Restore the account backup.")
	}
	defer clear(plain)
	if json.Unmarshal(plain, &login) != nil || validMacAccount(record.Username, login.Password) != nil {
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
	// A recovery during an interrupted password update must first confirm that
	// update, then apply the recovered password. Persist each confirmation so a
	// restart can retry either step without losing a keychain password.
	for {
		changed, err := a.syncMacPasswordStep(ctx, id, user, apply)
		if err != nil || !changed {
			return err
		}
	}
}

func (a *localAccount) syncMacPasswordStep(ctx context.Context, id uuid.UUID, user string, apply func(context.Context, string, string) error) (bool, error) {
	a.mu.Lock()
	if a.record == nil || a.record.MacLogin == nil || len(a.key) != 32 {
		a.mu.Unlock()
		return false, nil
	}
	login, err := a.openMacAccount()
	if err != nil {
		a.mu.Unlock()
		return false, err
	}
	guest, ok := login.Guests[id.String()]
	if !ok || guest.Password == login.Password && guest.PendingPassword == "" {
		a.mu.Unlock()
		return false, nil
	}
	if guest.Username != user {
		a.mu.Unlock()
		return false, errors.New("客机同步账户与安装记录不一致，原账户已保留")
	}
	target := login.Password
	if guest.PendingPassword != "" {
		target = guest.PendingPassword
	}
	a.mu.Unlock()
	if err = apply(ctx, guest.Password, target); err != nil {
		return false, errors.New("Cage 密码已保存；客机密码尚待同步，请启动客机后重试，期间客机仍可能需要原密码")
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	login, err = a.openMacAccount()
	if err != nil {
		return false, err
	}
	current, ok := login.Guests[id.String()]
	if !ok || current != guest || guest.PendingPassword == "" && login.Password != target {
		return false, errors.New("客机密码同步记录已变化，请重试")
	}
	current.Password = target
	current.PendingPassword = ""
	login.Guests[id.String()] = current
	record := *a.record
	if err = sealMacAccount(&record, a.key, login); err != nil {
		return false, err
	}
	if err = writePrivate(a.path, &record); err != nil {
		return false, errors.New("客机密码已更新，确认记录待保存；下次启动会重试确认")
	}
	a.record = &record
	return true, nil
}
