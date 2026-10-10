from worker.engram.probe import _labelled_tenant


def test_labelled_tenant_reads_without_inventing() -> None:
    assert _labelled_tenant({"tenant": "org:p:u"}) == "org:p:u"
    assert _labelled_tenant({"raw": {"tenant": "org:p:u"}}) == "org:p:u"

    class _Reply:
        tenant = None
        raw = {"tenant": "org:p:u"}

    assert _labelled_tenant(_Reply()) == "org:p:u"
    assert _labelled_tenant({}) is None
    assert _labelled_tenant("org:p:u") is None
