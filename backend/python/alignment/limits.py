"""Hard address-space/process-tree limits installed before importing ML libraries."""
import os

_job = None


def install(memory_bytes=6 * 1024 ** 3):
    global _job
    if os.name != 'nt':
        import resource
        resource.setrlimit(resource.RLIMIT_AS, (memory_bytes, memory_bytes))
        return
    import ctypes as c
    from ctypes import wintypes as w

    class Basic(c.Structure):
        _fields_ = [('processTime', c.c_int64), ('jobTime', c.c_int64),
                    ('flags', w.DWORD), ('minWorking', c.c_size_t),
                    ('maxWorking', c.c_size_t), ('active', w.DWORD),
                    ('affinity', c.c_size_t), ('priority', w.DWORD), ('scheduling', w.DWORD)]

    class IO(c.Structure):
        _fields_ = [(name, c.c_uint64) for name in
                    ('readOps', 'writeOps', 'otherOps', 'readBytes', 'writeBytes', 'otherBytes')]

    class Extended(c.Structure):
        _fields_ = [('basic', Basic), ('io', IO), ('processMemory', c.c_size_t),
                    ('jobMemory', c.c_size_t), ('peakProcess', c.c_size_t), ('peakJob', c.c_size_t)]

    kernel = c.WinDLL('kernel32', use_last_error=True)
    kernel.CreateJobObjectW.restype = w.HANDLE
    kernel.CreateJobObjectW.argtypes = [c.c_void_p, w.LPCWSTR]
    kernel.GetCurrentProcess.restype = w.HANDLE
    kernel.SetInformationJobObject.argtypes = [w.HANDLE, c.c_int, c.c_void_p, w.DWORD]
    kernel.AssignProcessToJobObject.argtypes = [w.HANDLE, w.HANDLE]
    _job = kernel.CreateJobObjectW(None, None)
    info = Extended()
    info.basic.flags = 0x2000 | 0x100 | 0x200  # kill on close; process and job memory caps
    info.processMemory = memory_bytes
    info.jobMemory = memory_bytes
    if not _job or not kernel.SetInformationJobObject(_job, 9, c.byref(info), c.sizeof(info)) or not kernel.AssignProcessToJobObject(_job, kernel.GetCurrentProcess()):
        raise ValueError('ALIGNMENT_MEMORY_LIMIT_UNAVAILABLE')
