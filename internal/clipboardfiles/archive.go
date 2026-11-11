// Package clipboardfiles streams selected ordinary files between guest systems.
// It has no host/guest process or authentication policy; callers own the selection.
package clipboardfiles

import (
	"archive/tar"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
)

const FileLimit int64 = 2 << 30
const SelectionLimit = 100

// LinkCachedFiles groups already frozen guest-cache files for one native file
// chooser without copying every attachment again. GUI callers validate ownership.
func LinkCachedFiles(paths []string) (result []string, err error) {
	return linkCachedFiles(paths, temporaryDirectory)
}

func temporaryDirectory() (string, error) { return os.MkdirTemp("", "cage-clipboard-") }

func linkCachedFiles(paths []string, directory func() (string, error)) (result []string, err error) {
	if len(paths) == 0 || len(paths) > SelectionLimit {
		return nil, errors.New("Select 1 to 100 files.")
	}
	root, err := directory()
	if err != nil {
		return nil, err
	}
	defer func() {
		if err != nil {
			_ = os.RemoveAll(root)
		}
	}()
	for _, source := range paths {
		name := filepath.Base(source)
		info, err := os.Lstat(source)
		if err != nil || !filepath.IsAbs(source) || !strings.HasPrefix(filepath.Base(filepath.Dir(source)), "cage-clipboard-") || !validName(name) || !info.Mode().IsRegular() || info.Size() > FileLimit {
			return nil, errors.New("Invalid attachment cache file.")
		}
		target := filepath.Join(root, name)
		if err := os.Link(source, target); err != nil {
			return nil, errors.New("Could not prepare the attachment selection. Check whether any file names are duplicated.")
		}
		linked, err := os.Lstat(target)
		if err != nil || !linked.Mode().IsRegular() || !os.SameFile(info, linked) {
			return nil, errors.New("The attachment cache has changed. Select the files again.")
		}
		result = append(result, target)
	}
	return result, nil
}

// Save receives one file into a newly owned cache directory. The caller can
// publish the returned path only after the complete bounded write succeeds.
func Save(input io.Reader, name string) (path string, err error) {
	return save(input, name, temporaryDirectory)
}

func save(input io.Reader, name string, directory func() (string, error)) (path string, err error) {
	if !validName(name) || strings.Contains(name, ":") {
		return "", errors.New("Invalid clipboard file name.")
	}
	root, err := directory()
	if err != nil {
		return "", err
	}
	defer func() {
		if err != nil {
			_ = os.RemoveAll(root)
		}
	}()
	path = filepath.Join(root, name)
	file, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		return "", err
	}
	count, writeErr := io.Copy(file, io.LimitReader(input, FileLimit+1))
	if count > FileLimit {
		writeErr = errors.New("Each file cannot exceed 2 GB.")
	}
	if writeErr == nil {
		writeErr = file.Sync()
	}
	if err = errors.Join(writeErr, file.Close()); err != nil {
		return "", err
	}
	return path, nil
}

func validName(name string) bool {
	return name != "" && len(name) <= 255 && name != "." && name != ".." && !strings.ContainsAny(name, "/\\\x00") &&
		!strings.ContainsFunc(name, func(r rune) bool { return r < 32 || r == 127 })
}

func Write(output io.Writer, paths []string) error {
	if len(paths) == 0 || len(paths) > SelectionLimit {
		return errors.New("Select 1 to 100 files or folders.")
	}
	writer := tar.NewWriter(output)
	names := map[string]bool{}
	for _, selected := range paths {
		name := filepath.Base(selected)
		if !filepath.IsAbs(selected) || !validName(name) || names[name] {
			return errors.New("Invalid or duplicate clipboard file name.")
		}
		names[name] = true
		err := filepath.Walk(selected, func(path string, info os.FileInfo, err error) error {
			if err != nil {
				return errors.New("Could not read the selected clipboard file.")
			}
			if !(info.Mode().IsRegular() || info.IsDir()) || info.Size() > FileLimit {
				return errors.New("The clipboard supports regular files and folders, up to 2 GB per file.")
			}
			relative, err := filepath.Rel(filepath.Dir(selected), path)
			if err != nil {
				return err
			}
			header, err := tar.FileInfoHeader(info, "")
			if err != nil {
				return err
			}
			header.Name = filepath.ToSlash(relative)
			if err := writer.WriteHeader(header); err != nil {
				return err
			}
			if !info.Mode().IsRegular() {
				return nil
			}
			file, err := os.Open(path)
			if err != nil {
				return errors.New("Could not read the selected clipboard file.")
			}
			defer file.Close()
			after, err := file.Stat()
			if err != nil || !os.SameFile(info, after) || after.Size() != info.Size() {
				return errors.New("The file has changed. Copy it again.")
			}
			_, err = io.CopyN(writer, file, info.Size())
			return err
		})
		if err != nil {
			return err
		}
	}
	return writer.Close()
}

func Read(input io.Reader) (paths []string, err error) {
	return read(input, temporaryDirectory)
}

func read(input io.Reader, directory func() (string, error)) (paths []string, err error) {
	root, err := directory()
	if err != nil {
		return nil, err
	}
	defer func() {
		if err != nil {
			_ = os.RemoveAll(root)
		}
	}()
	reader := tar.NewReader(input)
	names := map[string]bool{}
	for {
		header, readErr := reader.Next()
		if readErr == io.EOF {
			break
		}
		if readErr != nil {
			return nil, readErr
		}
		name := strings.TrimSuffix(header.Name, "/")
		parts := strings.Split(name, "/")
		if !filepath.IsLocal(filepath.FromSlash(name)) || header.Size < 0 || header.Size > FileLimit {
			return nil, errors.New("Invalid clipboard file location or size.")
		}
		for _, part := range parts {
			if !validName(part) || strings.Contains(part, ":") {
				return nil, errors.New("Invalid clipboard file name.")
			}
		}
		if !names[parts[0]] {
			names[parts[0]] = true
			paths = append(paths, filepath.Join(root, parts[0]))
			if len(paths) > SelectionLimit {
				return nil, errors.New("The number of clipboard files exceeds 100.")
			}
		}
		destination := filepath.Join(root, filepath.FromSlash(name))
		if err = os.MkdirAll(filepath.Dir(destination), 0700); err != nil {
			return nil, err
		}
		switch header.Typeflag {
		case tar.TypeDir:
			if err = os.MkdirAll(destination, 0700); err != nil {
				return nil, err
			}
		case tar.TypeReg, tar.TypeRegA:
			file, createErr := os.OpenFile(destination, os.O_WRONLY|os.O_CREATE|os.O_EXCL, os.FileMode(header.Mode)&0700|0600)
			if createErr != nil {
				return nil, createErr
			}
			_, copyErr := io.CopyN(file, reader, header.Size)
			closeErr := file.Close()
			if copyErr != nil || closeErr != nil {
				return nil, errors.Join(copyErr, closeErr)
			}
		default:
			return nil, errors.New("The clipboard does not support links or special files.")
		}
	}
	if len(paths) == 0 {
		return nil, errors.New("The clipboard file is empty.")
	}
	return paths, nil
}

func Copy(paths []string) ([]string, error) {
	return copyFiles(paths, temporaryDirectory)
}

func copyFiles(paths []string, directory func() (string, error)) ([]string, error) {
	reader, writer := io.Pipe()
	defer reader.Close()
	done := make(chan error, 1)
	go func() { err := Write(writer, paths); writer.CloseWithError(err); done <- err }()
	copied, err := read(reader, directory)
	reader.Close()
	if writeErr := <-done; writeErr != nil {
		if len(copied) > 0 {
			_ = os.RemoveAll(filepath.Dir(copied[0]))
		}
		return nil, writeErr
	}
	return copied, err
}
