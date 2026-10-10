from worker.admin.confirm import confirmation_matches


def test_exact_handle_confirms() -> None:
    assert confirmation_matches("audio-bot", "audio-bot") is True
    assert confirmation_matches("  audio-bot  ", "audio-bot") is True


def test_near_misses_do_not_confirm() -> None:
    assert confirmation_matches("Audio-Bot", "audio-bot") is False
    assert confirmation_matches("audio", "audio-bot") is False
    assert confirmation_matches("audio bot", "audio-bot") is False
    assert confirmation_matches("", "audio-bot") is False


def test_an_empty_expected_name_can_never_be_confirmed() -> None:
    assert confirmation_matches("", "") is False
    assert confirmation_matches("  ", "   ") is False
