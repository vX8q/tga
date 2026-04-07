package cache

import (
	"context"
	"sync"
	"time"
)

// TTL — простой in-memory кэш с TTL. Не ограничивает размер (для небольших объёмов).
// При отмене ctx горутина очистки завершается (корректный shutdown).
type TTL struct {
	mu    sync.RWMutex
	items map[string]item
	ttl   time.Duration
	done  chan struct{}
}

type item struct {
	value   []byte
	expires time.Time
}

// NewTTL создаёт кэш с заданным временем жизни записей.
// ctx: при отмене останавливается фоновая горутина очистки.
func NewTTL(ctx context.Context, ttl time.Duration) *TTL {
	c := &TTL{
		items: make(map[string]item),
		ttl:   ttl,
		done:  make(chan struct{}),
	}
	if ttl > 0 {
		go c.cleanLoop(ctx)
	}
	return c
}

func (c *TTL) cleanLoop(ctx context.Context) {
	tick := time.NewTicker(c.ttl)
	defer tick.Stop()
	for {
		select {
		case <-ctx.Done():
			close(c.done)
			return
		case <-tick.C:
			c.clean()
		}
	}
}

// Done возвращает канал, закрываемый при остановке горутины очистки (для тестов/ожидания shutdown).
func (c *TTL) Done() <-chan struct{} {
	return c.done
}

func (c *TTL) clean() {
	c.mu.Lock()
	defer c.mu.Unlock()
	now := time.Now()
	for k, v := range c.items {
		if v.expires.Before(now) {
			delete(c.items, k)
		}
	}
}

// Get возвращает значение по ключу, если оно ещё не истекло.
func (c *TTL) Get(key string) ([]byte, bool) {
	c.mu.RLock()
	v, ok := c.items[key]
	c.mu.RUnlock()
	if !ok || v.expires.Before(time.Now()) {
		return nil, false
	}
	return v.value, true
}

// Set сохраняет значение с TTL.
func (c *TTL) Set(key string, value []byte) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.items[key] = item{value: value, expires: time.Now().Add(c.ttl)}
}
