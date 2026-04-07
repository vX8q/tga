package schedulefile

// StageN возвращает таблицу стейджа n (1, 2, 3): сначала stage_n, затем legacy stageN.
func StageN(tables map[string]EventTable, n int) (EventTable, bool) {
	if tables == nil {
		return EventTable{}, false
	}
	ukey := stageUnderscore(n)
	lkey := stageLegacy(n)
	if t, ok := tables[ukey]; ok && len(t.Headers) > 0 {
		return t, true
	}
	if t, ok := tables[lkey]; ok && len(t.Headers) > 0 {
		return t, true
	}
	return EventTable{}, false
}

func stageUnderscore(n int) string {
	switch n {
	case 1:
		return "stage_1"
	case 2:
		return "stage_2"
	case 3:
		return "stage_3"
	default:
		return ""
	}
}

func stageLegacy(n int) string {
	switch n {
	case 1:
		return "stage1"
	case 2:
		return "stage2"
	case 3:
		return "stage3"
	default:
		return ""
	}
}
